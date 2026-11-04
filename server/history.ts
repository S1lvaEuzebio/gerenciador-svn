import { lstat } from 'node:fs/promises';
import type {
  ChangedPath,
  DiffResponse,
  HistoryCompare,
  LogCursor,
  LogEntry,
  LogPage,
  Project,
} from '../shared/types.ts';
import {
  compareSources,
  handledLater,
  NONE,
  propsDiff,
  workingSource,
  type Source,
} from './diff.ts';
import { HttpError } from './http-error.ts';
import {
  knownProjects,
  projectPathOf,
  repoPathOf,
  repositoryUrl,
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

export interface LogFilters {
  author: string;
  text: string;
}

/** Minúsculas e sem acento: "Configuração" casa com "configuracao". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Autor e texto da mensagem, sem diferenciar maiúsculas nem acentos; `null` sem filtro. */
function matcher(filters: LogFilters): ((entry: LogEntry) => boolean) | null {
  const author = normalize(filters.author.trim());
  const text = normalize(filters.text.trim());
  if (author === '' && text === '') return null;
  return (entry) =>
    normalize(entry.author).includes(author) && normalize(entry.message).includes(text);
}

/**
 * Mudança de `path` na revisão. Quando uma pasta acima foi copiada (ou renomeada) nela, o caminho
 * não aparece na lista do svn: vira uma cópia do caminho correspondente na origem.
 */
function changeAt(paths: ChangedPath[], path: string): ChangedPath | undefined {
  const exact = paths.find((p) => p.path === path);
  if (exact) return exact;
  const parent = paths
    .filter((p) => p.copyFrom && path.startsWith(`${p.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!parent?.copyFrom) return undefined;
  return {
    path,
    action: 'A',
    kind: 'unknown',
    copyFrom: {
      path: parent.copyFrom.path + path.slice(parent.path.length),
      revision: parent.copyFrom.revision,
    },
  };
}

/** Projeto onde o caminho do repositório cai; o mais específico, e os do filtro na frente. */
function withProject(change: ChangedPath, projects: Project[]): ChangedPath {
  let best: { project: Project; path: string } | undefined;
  for (const project of projects) {
    const path = projectPathOf(project, change.path);
    if (path !== null && (!best || project.relativeUrl.length > best.project.relativeUrl.length)) {
      best = { project, path };
    }
  }
  return best ? { ...change, project: { id: best.project.id, path: best.path } } : change;
}

/** Alvos do `svn log`: um caminho só, ou a raiz do repositório com os caminhos dos projetos. */
function logTargets(scope: Project[], filePath: string | null, peg: number | 'HEAD'): string[] {
  const repo = scope[0]!;
  if (filePath !== null) return [repositoryUrl(repo, filePath, peg)];
  if (scope.length === 1) return [repositoryUrl(repo, repoPathOf(repo, ''), peg)];
  return [repositoryUrl(repo, '', peg), ...scope.map((p) => repoPathOf(p, '').slice(1) || '.')];
}

/**
 * Revisão de onde o histórico de arquivo parte: HEAD ou, se o arquivo não existe mais no servidor
 * (apagado ou renomeado lá depois do último update), a revisão dele na working copy.
 */
async function fileStart(project: Project, file: string, repoPath: string) {
  try {
    await svnInfo(repositoryUrl(project, repoPath, 'HEAD'));
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
  filters: LogFilters,
): Promise<LogPage> {
  const repo = scope[0];
  if (!repo) throw new HttpError(400, 'nenhum projeto escolhido');
  if (scope.some((p) => p.repoRootUrl !== repo.repoRootUrl)) {
    throw new HttpError(
      400,
      'Os projetos deste filtro estão em repositórios diferentes. O histórico unificado precisa de um repositório só: escolha um projeto.',
    );
  }
  if (file !== null && scope.length !== 1) {
    throw new HttpError(400, 'histórico de arquivo é de um projeto só');
  }

  const others = (await knownProjects()).filter(
    (p) => p.repoRootUrl === repo.repoRootUrl && !scope.includes(p),
  );
  const projects = [...scope, ...others];
  const matches = matcher(filters);
  const limit = matches ? FILTER_BATCH : PAGE_SIZE;

  let filePath = file === null ? null : (cursor?.path ?? repoPathOf(repo, file));
  let before: number | 'HEAD' =
    cursor?.before ?? (file !== null ? await fileStart(repo, file, filePath!) : 'HEAD');
  let scanned = 0;
  let scannedTo: number | null = null;
  const entries: LogEntry[] = [];

  for (;;) {
    const batch = await svnLog(logTargets(scope, filePath, before), `${before}:1`, limit);
    const exhausted = batch.length < limit;
    for (const [i, entry] of batch.entries()) {
      scannedTo = entry.revision;
      let fileChange: ChangedPath | undefined;
      if (filePath !== null) {
        fileChange = changeAt(entry.paths, filePath);
        if (fileChange?.copyFrom) filePath = fileChange.copyFrom.path;
      }
      if (matches && !matches(entry)) continue;
      entries.push({
        ...entry,
        paths: entry.paths.map((p) => withProject(p, projects)),
        ...(fileChange && { file: withProject(fileChange, projects) }),
      });
      if (entries.length === PAGE_SIZE) {
        const atEnd = (exhausted && i === batch.length - 1) || entry.revision <= 1;
        return {
          entries,
          next: atEnd ? null : { before: entry.revision - 1, path: filePath },
          scannedTo,
        };
      }
    }
    const last = batch.at(-1);
    if (exhausted || !last || last.revision <= 1) return { entries, next: null, scannedTo };
    before = last.revision - 1;
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
  const at = (path: string, rev: number): Source => ({
    from: 'repo',
    url: repositoryUrl(project, path, rev),
  });

  if (compare === 'current') {
    if (local === null) throw new HttpError(400, 'falta o arquivo local para comparar');
    const absolute = resolveInProject(project, local);
    const info = await lstat(absolute).catch(() => null);
    const right = workingSource(absolute, info);
    return compareSources(at(repoPath, revision), right, Promise.resolve(undefined), force);
  }

  const [entry] = await svnLog([repositoryUrl(project, '', revision)], String(revision), 1, true);
  const change = entry && changeAt(entry.paths, repoPath);
  if (!change) throw new HttpError(404, `${repoPath} não mudou na r${revision}`);

  const props = handledLater(
    change.action !== 'D' && change.propMods !== false
      ? propsDiff(repositoryUrl(project, repoPath, revision), ['-c', String(revision)])
      : Promise.resolve(undefined),
  );
  if (change.kind === 'dir') return { kind: 'directory', item: 'normal', propsDiff: await props };

  const left = change.copyFrom
    ? at(change.copyFrom.path, change.copyFrom.revision)
    : change.action === 'A'
      ? NONE
      : at(repoPath, revision - 1);
  const right = change.action === 'D' ? NONE : at(repoPath, revision);
  return compareSources(left, right, props, force);
}
