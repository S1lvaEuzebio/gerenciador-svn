import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { AppConfig } from '../shared/schema.ts';
import type {
  CommitAction,
  CommitItem,
  CommitPreview,
  CommitPreviewProject,
  CommitRequest,
  ItemStatus,
  Operation,
  Project,
} from '../shared/types.ts';
import { isConflicted, isPropsOnly } from '../shared/status.ts';
import { HttpError } from './http-error.ts';
import { projectIgnoreMatcher } from './ignore.ts';
import { isChange, nodeKind } from './local-status.ts';
import { startOperation, type StepSpec } from './operations.ts';
import { relativeToProject, requireProject, resolveInProject } from './projects.ts';
import { svnInfo, svnTree } from './svn/info.ts';
import { localTarget, svnCommandLine } from './svn/run.ts';
import { svnRemoteStatus, svnStatus, type StatusEntry } from './svn/status.ts';

/** Limite de itens ao abrir uma pasta nova marcada para o commit. */
const MAX_FOLDER_ITEMS = 500;

const ACTIONS: Partial<Record<ItemStatus, CommitAction>> = {
  unversioned: 'to-add',
  missing: 'to-delete',
  added: 'added',
  deleted: 'deleted',
  modified: 'modified',
  replaced: 'replaced',
};

function actionFor(entry: StatusEntry): CommitAction | null {
  const action = ACTIONS[entry.item];
  if (action) return action;
  return isPropsOnly(entry) ? 'props' : null;
}

/** Ordem por código, para a pasta vir sempre antes do que tem dentro (`a` < `a/b`). */
const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Arquivos e pastas dentro de uma pasta nova, sem o que casa com os padrões de ignorados. */
async function folderContent(
  project: Project,
  absolute: string,
  isIgnored: (path: string) => boolean,
): Promise<CommitItem[] | null> {
  const items: CommitItem[] = [];
  const walk = async (dir: string): Promise<boolean> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.svn') continue;
      const path = relativeToProject(project, join(dir, entry.name));
      if (isIgnored(path)) continue;
      const kind = entry.isDirectory() ? 'dir' : 'file';
      items.push({ path, kind, action: 'to-add', included: 'content' });
      if (items.length > MAX_FOLDER_ITEMS) return false;
      if (kind === 'dir' && !(await walk(join(dir, entry.name)))) return false;
    }
    return true;
  };
  return (await walk(absolute)) ? items : null;
}

interface ProjectPlan {
  project: Project;
  items: CommitItem[];
  outdated: string[];
}

/**
 * Lista final de um projeto: os caminhos marcados, o conteúdo de pastas novas ou apagadas e as
 * pastas novas acima dos itens, que o svn exige no mesmo commit.
 */
async function planProject(
  project: Project,
  paths: string[],
  config: AppConfig,
  checkRemote: boolean,
  errors: string[],
): Promise<ProjectPlan> {
  const isIgnored = projectIgnoreMatcher(config, project.id);
  const entries = new Map(
    (await svnStatus(project.id)).map((e) => [relativeToProject(project, e.path), e]),
  );
  const items = new Map<string, CommitItem>();
  const add = (item: CommitItem) => {
    if (!items.has(item.path)) items.set(item.path, item);
  };
  const label = (path: string) => (path === '' ? project.name : `${project.name}/${path}`);

  for (const path of paths) {
    const absolute = resolveInProject(project, path);
    const entry = entries.get(path);
    if (!entry || !isChange(entry)) {
      errors.push(`${label(path)}: não tem mudança para comitar`);
      continue;
    }
    if (isIgnored(path)) {
      errors.push(`${label(path)}: casa com um padrão de ignorados e nunca entra em commit`);
      continue;
    }
    if (isConflicted(entry)) {
      errors.push(`${label(path)}: em conflito; resolva antes de comitar`);
      continue;
    }
    const action = actionFor(entry);
    if (!action) {
      errors.push(`${label(path)}: o estado "${entry.item}" não pode ser comitado`);
      continue;
    }
    // Item apagado ou faltando não existe mais no disco: o tipo vem do svn.
    const onDisk = await nodeKind(absolute);
    const kind =
      onDisk !== 'unknown'
        ? onDisk
        : await svnInfo(absolute).then(
            (info) => info.kind,
            () => onDisk,
          );
    add({ path, kind, action });

    if (action === 'to-add' && kind === 'dir') {
      const content = await folderContent(project, absolute, isIgnored);
      if (!content) {
        errors.push(
          `${label(path)}: pasta nova com mais de ${MAX_FOLDER_ITEMS} itens; marque partes dela`,
        );
      }
      content?.forEach(add);
    }
  }

  // Apagar uma pasta leva tudo o que tem dentro: os filhos aparecem na lista, mas o commit vai
  // só com a pasta. Se algum filho casa com os padrões de ignorados, a pasta não pode ir.
  const deletedFolders = [...items.values()].filter(
    (i) => (i.action === 'deleted' || i.action === 'to-delete') && i.kind === 'dir',
  );
  for (const folder of deletedFolders) {
    const tree = await svnTree(resolveInProject(project, folder.path));
    const content = tree
      .map((node) => ({ ...node, path: relativeToProject(project, node.path) }))
      .filter((node) => node.path !== folder.path);
    const ignored = content.filter((node) => isIgnored(node.path)).map((node) => node.path);
    if (ignored.length > 0) {
      errors.push(
        `${label(folder.path)}: apagar a pasta levaria arquivos ignorados para o commit (${ignored.join(', ')})`,
      );
    }
    for (const node of content) {
      items.set(node.path, {
        path: node.path,
        kind: node.kind,
        action: folder.action,
        included: 'content',
      });
    }
  }

  // Pasta já adicionada (ex.: sobrou de um commit que falhou depois do svn add) leva o que foi
  // adicionado dentro dela; com --depth empty, sozinha ela subiria vazia.
  for (const folder of [...items.values()].filter(
    (i) => i.action === 'added' && i.kind === 'dir' && i.included === undefined,
  )) {
    for (const [path, entry] of entries) {
      if (path.startsWith(`${folder.path}/`) && entry.item === 'added' && !isIgnored(path)) {
        add({
          path,
          kind: await nodeKind(resolveInProject(project, path)),
          action: 'added',
          included: 'content',
        });
      }
    }
  }

  for (const item of [...items.values()]) {
    for (let parent = posix.dirname(item.path); parent !== '.'; parent = posix.dirname(parent)) {
      if (entries.get(parent)?.item === 'added') {
        add({ path: parent, kind: 'dir', action: 'added', included: 'parent' });
      }
    }
  }

  const sorted = [...items.values()].sort(byPath);
  let outdated: string[] = [];
  if (checkRemote && sorted.length > 0) {
    const remote = await svnRemoteStatus(project.id);
    const changed = new Set(
      remote.entries.filter((e) => e.remote).map((e) => relativeToProject(project, e.path)),
    );
    outdated = sorted
      .filter((i) => i.included !== 'content' && changed.has(i.path))
      .map((i) => i.path);
  }
  return { project, items: sorted, outdated };
}

interface Plan extends CommitPreview {
  specs: StepSpec[];
}

/** Monta o commit: lista final por projeto e os comandos (`svn add`, `svn delete`, `svn commit`). */
async function buildPlan(
  { items, message }: CommitRequest,
  config: AppConfig,
  checkRemote: boolean,
): Promise<Plan> {
  const errors: string[] = [];
  if (message.trim() === '') errors.push('a mensagem do commit é obrigatória');

  const pathsByProject = new Map<string, string[]>();
  for (const { projectId, path } of items) {
    pathsByProject.set(projectId, [...(pathsByProject.get(projectId) ?? []), path]);
  }
  const projects = await Promise.all([...pathsByProject.keys()].map((id) => requireProject(id)));
  if (new Set(projects.map((p) => p.repoRootUrl)).size > 1) {
    errors.push('os projetos marcados são de repositórios diferentes; um commit vale para um só');
  }
  const plans = await Promise.all(
    projects.map((p) => planProject(p, pathsByProject.get(p.id)!, config, checkRemote, errors)),
  );

  const all = plans.flatMap((plan) =>
    plan.items.map((item) => ({ item, absolute: resolveInProject(plan.project, item.path) })),
  );
  const pick = (keep: (item: CommitItem) => boolean) =>
    all.filter(({ item }) => keep(item)).map(({ absolute }) => localTarget(absolute));
  // Conteúdo de pasta apagada vai junto com a pasta; não entra como alvo.
  const removedContent = (i: CommitItem) =>
    i.included === 'content' && (i.action === 'deleted' || i.action === 'to-delete');
  const adds = pick((i) => i.action === 'to-add');
  const deletes = pick((i) => i.action === 'to-delete' && !removedContent(i));
  const targets = pick((i) => !removedContent(i));

  const projectIds = projects.map((p) => p.id);
  const specs: StepSpec[] = [
    ...(adds.length > 0
      ? [{ label: 'svn add', projectIds, args: ['add', '--depth', 'empty', ...adds] }]
      : []),
    ...(deletes.length > 0
      ? [{ label: 'svn delete', projectIds, args: ['delete', ...deletes] }]
      : []),
    {
      label: 'svn commit',
      projectIds,
      args: ['commit', '--depth', 'empty', '-m', message, ...targets],
    },
  ];
  const commands = specs.map((s) => svnCommandLine(s.args));
  return {
    projects: plans.map((p): CommitPreviewProject => ({
      projectId: p.project.id,
      items: p.items,
      outdated: p.outdated,
    })),
    commands,
    errors,
    fingerprint: createHash('sha256').update(commands.join('\n')).digest('hex'),
    specs,
  };
}

/** Prévia do commit, com a checagem de desatualizados (consulta o servidor). */
export async function commitPreview(
  request: CommitRequest,
  config: AppConfig,
): Promise<CommitPreview> {
  const { specs: _specs, ...preview } = await buildPlan(request, config, true);
  return preview;
}

/**
 * Roda o commit confirmado. Monta o plano de novo e só segue se for o mesmo da prévia
 * (`fingerprint`): nada entra no commit sem ter aparecido na confirmação.
 */
export async function startCommit(
  request: CommitRequest,
  config: AppConfig,
  fingerprint: string,
): Promise<Operation> {
  const plan = await buildPlan(request, config, false);
  if (plan.errors.length > 0) throw new HttpError(400, plan.errors.join('; '));
  if (plan.fingerprint !== fingerprint) {
    throw new HttpError(409, 'a lista do commit mudou desde a prévia; confira de novo');
  }
  return startOperation('Commit', plan.specs, 'sequence');
}
