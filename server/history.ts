import { lstat } from 'node:fs/promises';
import { changeSides, hasFilters } from '../shared/history.ts';
import type {
  ChangedPath,
  DiffResponse,
  HistoryCompare,
  HistoryFilters,
  LogCursor,
  LogEntry,
  LogPage,
  Project,
  RepoNode,
} from '../shared/types.ts';
import {
  ABSENT,
  compareSources,
  noUnhandledRejection,
  propsDiff,
  workingSource,
  type Source,
} from './diff.ts';
import { HttpError } from './http-error.ts';
import {
  knownProjects,
  projectFileAt,
  repoPathOf,
  repoPathUrl,
  resolveInProject,
} from './projects.ts';
import { svnInfo } from './svn/info.ts';
import { svnLog } from './svn/log.ts';
import { isNotFound } from './svn/run.ts';

const PAGE_SIZE = 50;
/** Com filtro, o svn devolve tudo e o filtro roda aqui: o log vem em lotes até encher a página. */
const FILTER_BATCH = 200;
/** Revisões examinadas por pedido com filtro; depois disso a tela oferece continuar. */
const MAX_SCANNED = 1000;

/** Minúsculas e sem acento: "Configuração" casa com "configuracao". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Autor e texto da mensagem, sem diferenciar maiúsculas nem acentos; `null` sem filtro. */
function matcher(filters: HistoryFilters): ((entry: LogEntry) => boolean) | null {
  if (!hasFilters(filters)) return null;
  const author = normalize(filters.author.trim());
  const text = normalize(filters.text.trim());
  return (entry) =>
    normalize(entry.author).includes(author) && normalize(entry.message).includes(text);
}

/**
 * Mudança de `path` na revisão. Quando uma pasta acima foi copiada (ou renomeada) nela, o caminho
 * veio da origem correspondente: o svn não o lista, ou lista só como modificado ou apagado dentro
 * da cópia, sem a origem.
 */
function changeAt(paths: ChangedPath[], path: string): ChangedPath | undefined {
  const exact = paths.find((p) => p.path === path);
  // Com origem própria, ou criado do zero (sem cópia): nada a herdar da pasta acima.
  if (exact && (exact.copyFrom || exact.action === 'A' || exact.action === 'R')) return exact;
  const parent = paths
    .filter((p) => p.copyFrom && path.startsWith(`${p.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!parent?.copyFrom) return exact;
  const copyFrom = {
    path: parent.copyFrom.path + path.slice(parent.path.length),
    revision: parent.copyFrom.revision,
  };
  return exact ? { ...exact, copyFrom } : { path, action: 'A', kind: 'unknown', copyFrom };
}

/** O primeiro projeto do filtro dá a URL do repositório (todos têm a mesma). */
function logTargets(scope: Project[], filePath: string | null, peg: number | 'HEAD'): string[] {
  const project = scope[0]!;
  if (filePath !== null) return [repoPathUrl(project, filePath, peg)];
  if (scope.length === 1) return [repoPathUrl(project, repoPathOf(project, ''), peg)];
  // Raiz do repositório seguida dos caminhos dos projetos: um log só, já em ordem.
  return [repoPathUrl(project, '', peg), ...scope.map((p) => repoPathOf(p, '').slice(1) || '.')];
}

/**
 * Revisão de onde o histórico de arquivo parte: HEAD ou, se o arquivo não existe mais no servidor
 * (apagado ou renomeado lá depois do último update), a revisão dele na working copy.
 */
async function fileStart(project: Project, file: string, repoPath: string) {
  try {
    await svnInfo(repoPathUrl(project, repoPath, 'HEAD'));
    return 'HEAD';
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const local = await svnInfo(resolveInProject(project, file)).catch(() => null);
  if (!local?.revision) throw new HttpError(404, 'o arquivo não está no servidor');
  return local.revision;
}

/**
 * Histórico de um ou mais projetos (log unificado, precisam ser do mesmo repositório) ou de um
 * arquivo, em páginas de 50, da revisão mais nova para a mais antiga. O histórico de arquivo
 * segue as renomeações: cada entrada traz o caminho que o arquivo tinha naquela revisão.
 */
export async function historyLog(
  scope: Project[],
  file: string | null,
  cursor: LogCursor | null,
  filters: HistoryFilters,
): Promise<LogPage> {
  const project = scope[0];
  if (!project) throw new HttpError(400, 'nenhum projeto escolhido');
  if (scope.some((p) => p.repoRootUrl !== project.repoRootUrl)) {
    throw new HttpError(
      400,
      'Os projetos deste filtro estão em repositórios diferentes. O histórico unificado precisa de um repositório só: escolha um projeto.',
    );
  }
  if (file !== null && scope.length !== 1) {
    throw new HttpError(400, 'histórico de arquivo é de um projeto só');
  }
  // Como em toda rota, o caminho tem de ficar dentro da working copy.
  if (file !== null) resolveInProject(project, file);

  const others = (await knownProjects()).filter(
    (p) => p.repoRootUrl === project.repoRootUrl && !scope.includes(p),
  );
  const projects = [...scope, ...others];
  const matches = matcher(filters);
  const limit = matches ? FILTER_BATCH : PAGE_SIZE;

  const withProject = (change: ChangedPath): ChangedPath => {
    const owner = projectFileAt(projects, change.path);
    return owner ? { ...change, project: owner } : change;
  };

  let filePath = file === null ? null : (cursor?.path ?? repoPathOf(project, file));
  let before: number | 'HEAD' =
    cursor?.before ?? (file !== null ? await fileStart(project, file, filePath!) : 'HEAD');
  let scanned = 0;
  let scannedTo: number | null = null;
  const entries: LogEntry[] = [];

  for (;;) {
    const batch = await svnLog(logTargets(scope, filePath, before), `${before}:1`, limit);
    const exhausted = batch.length < limit;
    let nextBefore = 0;
    for (const [i, entry] of batch.entries()) {
      scannedTo = entry.revision;
      nextBefore = entry.revision - 1;
      let fileChange: ChangedPath | undefined;
      if (filePath !== null) {
        fileChange = changeAt(entry.paths, filePath);
        // Depois de uma cópia, a história do arquivo segue na origem, a partir da revisão
        // copiada; o que mudou na origem depois disso não faz parte dela.
        if (fileChange?.copyFrom) {
          filePath = fileChange.copyFrom.path;
          nextBefore = fileChange.copyFrom.revision;
        }
      }
      if (matches && !matches(entry)) continue;
      entries.push({
        ...entry,
        paths: entry.paths.map(withProject),
        ...(fileChange && { file: withProject(fileChange) }),
      });
      if (entries.length === PAGE_SIZE) {
        const atEnd = (exhausted && i === batch.length - 1) || nextBefore < 1;
        return { entries, next: atEnd ? null : { before: nextBefore, path: filePath }, scannedTo };
      }
    }
    if (exhausted || nextBefore < 1) return { entries, next: null, scannedTo };
    before = nextBefore;
    scanned += batch.length;
    if (scanned >= MAX_SCANNED) {
      return { entries, next: { before, path: filePath }, scannedTo };
    }
  }
}

/**
 * Diff de um caminho do repositório numa revisão. `change`: o que a revisão mudou nele (contra
 * a origem, quando foi copiado ou renomeado). `current`: o caminho naquela revisão comparado com
 * o arquivo `local` da working copy de `project`.
 */
export async function historyDiff(
  project: Project,
  repoPath: string,
  revision: number,
  compare: HistoryCompare,
  local: string | null,
  force: boolean,
): Promise<DiffResponse> {
  const side = (node: RepoNode | null): Source =>
    node ? { from: 'repo', url: repoPathUrl(project, node.path, node.revision) } : ABSENT;

  if (compare === 'current') {
    if (local === null) throw new HttpError(400, 'falta o arquivo local para comparar');
    const absolute = resolveInProject(project, local);
    const info = await lstat(absolute).catch(() => null);
    if (!info) throw new HttpError(404, 'o arquivo não existe na working copy');
    const left = side({ path: repoPath, revision });
    return compareSources(left, workingSource(absolute, info), Promise.resolve(undefined), force);
  }

  const [entry] = await svnLog([repoPathUrl(project, '', revision)], String(revision), 1, true);
  const change = entry && changeAt(entry.paths, repoPath);
  if (!change) throw new HttpError(404, `${repoPath} não mudou na r${revision}`);

  const props = noUnhandledRejection(
    change.action !== 'D' && change.propMods !== false
      ? propsDiff(repoPathUrl(project, repoPath, revision), ['-c', String(revision)])
      : Promise.resolve(undefined),
  );
  if (change.kind === 'dir') return { kind: 'directory', item: 'normal', propsDiff: await props };

  const [left, right] = changeSides(change, revision);
  return compareSources(side(left), side(right), props, force);
}
