import type {
  ItemStatus,
  Operation,
  Project,
  RevertItem,
  RevertPreview,
  RevertRequest,
} from '../shared/types.ts';
import { HttpError } from './http-error.ts';
import { isChange, nodeKind, versionedKind } from './local-status.ts';
import { planFingerprint, startOperation, type StepSpec } from './operations.ts';
import { relativeToProject, requireProject, resolveInProject } from './projects.ts';
import { svnTree } from './svn/info.ts';
import { localTarget, svnCommandLine } from './svn/run.ts';
import { svnStatus } from './svn/status.ts';

/**
 * Pastas que voltam inteiras (`--depth infinity`): só a pasta, sem o que tem dentro, deixaria
 * o conteúdo adicionado, apagado ou faltando.
 */
const WHOLE_FOLDER = new Set<ItemStatus>(['added', 'deleted', 'missing', 'replaced']);

const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const isInside = (path: string, folder: string) => path.startsWith(`${folder}/`);

interface ProjectPlan {
  project: Project;
  items: RevertItem[];
  specs: StepSpec[];
}

async function planProject(
  project: Project,
  paths: string[],
  errors: string[],
): Promise<ProjectPlan> {
  const entries = new Map(
    (await svnStatus(project.id)).map((e) => [relativeToProject(project, e.path), e]),
  );
  const items = new Map<string, RevertItem>();
  const label = (path: string) => (path === '' ? project.name : `${project.name}/${path}`);

  for (const path of paths) {
    const absolute = resolveInProject(project, path);
    const entry = entries.get(path);
    if (!entry || !isChange(entry)) {
      errors.push(`${label(path)}: não tem mudança para reverter`);
      continue;
    }
    if (entry.item === 'unversioned') {
      errors.push(`${label(path)}: não versionado; o revert não apaga arquivos`);
      continue;
    }
    items.set(path, {
      path,
      kind: await versionedKind(absolute),
      item: entry.item,
      props: entry.props,
      treeConflict: entry.treeConflict,
    });
  }

  const candidates = [...items.values()].filter(
    (i) => i.kind === 'dir' && WHOLE_FOLDER.has(i.item),
  );
  const wholeFolders = candidates.filter(
    (f) => !candidates.some((other) => isInside(f.path, other.path)),
  );
  for (const folder of wholeFolders) {
    // Pasta apagada ou faltando: o status não lista tudo o que tinha dentro, o svn info sim.
    const inside: RevertItem[] =
      folder.item === 'deleted' || folder.item === 'missing'
        ? (await svnTree(resolveInProject(project, folder.path)))
            .map((node) => ({ ...node, path: relativeToProject(project, node.path) }))
            .filter((node) => isInside(node.path, folder.path))
            .map((node) => ({ ...node, item: folder.item, props: 'none', treeConflict: false }))
        : await Promise.all(
            [...entries]
              .filter(
                ([path, e]) =>
                  isInside(path, folder.path) && isChange(e) && e.item !== 'unversioned',
              )
              .map(async ([path, e]) => ({
                path,
                kind: await nodeKind(resolveInProject(project, path)),
                item: e.item,
                props: e.props,
                treeConflict: e.treeConflict,
              })),
          );
    for (const item of inside) {
      if (!items.has(item.path)) items.set(item.path, { ...item, included: 'content' });
    }
  }

  const targets = (keep: (item: RevertItem) => boolean) =>
    [...items.values()]
      .filter((i) => i.included === undefined && keep(i))
      .sort(byPath)
      .map((i) => localTarget(resolveInProject(project, i.path)));
  const single = targets(
    (i) => !wholeFolders.includes(i) && !wholeFolders.some((f) => isInside(i.path, f.path)),
  );
  const whole = targets((i) => wholeFolders.includes(i));
  const specs: StepSpec[] = [
    ...(single.length > 0
      ? [
          {
            label: project.name,
            projectIds: [project.id],
            args: ['revert', '--depth', 'empty', ...single],
          },
        ]
      : []),
    ...(whole.length > 0
      ? [
          {
            label: `${project.name}: pastas inteiras`,
            projectIds: [project.id],
            args: ['revert', '--depth', 'infinity', ...whole],
          },
        ]
      : []),
  ];
  return { project, items: [...items.values()].sort(byPath), specs };
}

interface Plan extends RevertPreview {
  specs: StepSpec[];
}

async function buildPlan({ items }: RevertRequest): Promise<Plan> {
  const errors: string[] = [];
  const pathsByProject = new Map<string, string[]>();
  for (const { projectId, path } of items) {
    pathsByProject.set(projectId, [...(pathsByProject.get(projectId) ?? []), path]);
  }
  const projects = await Promise.all([...pathsByProject.keys()].map((id) => requireProject(id)));
  const plans = await Promise.all(
    projects.map((p) => planProject(p, pathsByProject.get(p.id)!, errors)),
  );
  const specs = plans.flatMap((p) => p.specs);
  const commands = specs.map((s) => svnCommandLine(s.args));
  return {
    projects: plans
      .filter((p) => p.items.length > 0)
      .map((p) => ({ projectId: p.project.id, items: p.items })),
    commands,
    errors,
    fingerprint: planFingerprint(commands),
    specs,
  };
}

/** Prévia do revert: lista final por projeto (com o que volta junto) e os comandos. */
export async function revertPreview(request: RevertRequest): Promise<RevertPreview> {
  const { specs: _specs, ...preview } = await buildPlan(request);
  return preview;
}

/**
 * Roda o revert confirmado, cada projeto na fila da sua working copy. Monta o plano de novo e só
 * segue se for o mesmo da prévia.
 */
export async function startRevert(request: RevertRequest, fingerprint: string): Promise<Operation> {
  const plan = await buildPlan(request);
  if (plan.errors.length > 0) throw new HttpError(400, plan.errors.join('; '));
  if (plan.specs.length === 0) throw new HttpError(400, 'nada para reverter');
  if (plan.fingerprint !== fingerprint) {
    throw new HttpError(409, 'a lista do revert mudou desde a prévia; confira de novo');
  }
  return startOperation('Revert', plan.specs, 'parallel');
}
