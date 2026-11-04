import { readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Project, ProjectFile, ProjectsResponse, RootError } from '../shared/types.ts';
import { resolvedRoots } from './config.ts';
import { HttpError } from './http-error.ts';
import { svnInfo } from './svn/info.ts';

let cache = new Map<string, Project>();

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Subpastas diretas da raiz que são working copies SVN (têm `.svn`). */
async function workingCopiesIn(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => join(root, e.name));
  const checks = await Promise.all(
    candidates.map(async (dir) => ((await isDirectory(join(dir, '.svn'))) ? dir : null)),
  );
  return checks.filter((dir): dir is string => dir !== null);
}

export async function discoverProjects(): Promise<ProjectsResponse> {
  const projects: Project[] = [];
  const errors: RootError[] = [];

  for (const root of resolvedRoots()) {
    let dirs: string[];
    try {
      dirs = await workingCopiesIn(root);
    } catch (error) {
      errors.push({ root, message: (error as Error).message });
      continue;
    }
    const infos = await Promise.allSettled(dirs.map((dir) => svnInfo(dir)));
    infos.forEach((result, i) => {
      const dir = dirs[i]!;
      if (result.status === 'rejected') {
        errors.push({ root: dir, message: (result.reason as Error).message });
        return;
      }
      projects.push({
        id: dir,
        name: basename(dir),
        root,
        repoRootUrl: result.value.repoRootUrl,
        relativeUrl: result.value.relativeUrl,
        revision: result.value.revision,
      });
    });
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  cache = new Map(projects.map((p) => [p.id, p]));
  return { projects, errors };
}

async function ensureDiscovered(): Promise<void> {
  if (cache.size === 0) await discoverProjects();
}

/** Projetos da última descoberta; descobre de novo se ainda não houve nenhuma. */
export async function knownProjects(): Promise<Project[]> {
  await ensureDiscovered();
  return [...cache.values()];
}

/** Só aceita ids de projetos descobertos: o svn nunca roda em caminho arbitrário. */
export async function requireProject(id: string): Promise<Project> {
  await ensureDiscovered();
  const project = cache.get(id);
  if (!project) throw new HttpError(404, 'projeto desconhecido');
  return project;
}

/** Resolve um caminho relativo dentro do projeto, recusando qualquer coisa que escape dele. */
export function resolveInProject(project: Project, relativePath: string): string {
  const absolute = resolve(project.id, relativePath);
  const rel = relative(project.id, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new HttpError(400, 'caminho fora do projeto');
  }
  return absolute;
}

/** Caminho absoluto de dentro do projeto → relativo à working copy, com `/`. */
export function relativeToProject(project: Project, absolute: string): string {
  return relative(project.id, absolute).split(sep).join('/');
}

/** Caminho do projeto no repositório: `^/projeto/trunk` → `/projeto/trunk`. */
const projectBase = (project: Project) => project.relativeUrl.slice(1);

/** Caminho do projeto → caminho no repositório (`a.txt` → `/projeto/trunk/a.txt`). */
export function repoPathOf(project: Project, relativePath: string): string {
  const base = projectBase(project);
  if (relativePath === '') return base;
  return base.endsWith('/') ? `${base}${relativePath}` : `${base}/${relativePath}`;
}

/** Caminho no repositório → caminho relativo ao projeto; `null` se cai fora dele. */
export function projectPathOf(project: Project, repoPath: string): string | null {
  const base = projectBase(project);
  if (repoPath === base) return '';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
}

/**
 * Projeto onde o caminho do repositório cai, com o caminho relativo a ele. Vale o mais
 * específico; no empate, o que vem antes na lista.
 */
export function projectFileAt(projects: Project[], repoPath: string): ProjectFile | undefined {
  let best: { project: Project; path: string } | undefined;
  for (const project of projects) {
    const path = projectPathOf(project, repoPath);
    if (path !== null && (!best || project.relativeUrl.length > best.project.relativeUrl.length)) {
      best = { project, path };
    }
  }
  return best && { projectId: best.project.id, path: best.path };
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * URL de um caminho a partir da raiz do repositório do projeto (`/projeto/trunk/a.txt`), presa
 * à revisão (`url@rev`).
 */
export function repoPathUrl(project: Project, repoPath: string, revision: number | 'HEAD'): string {
  return `${project.repoRootUrl}${encodePath(repoPath)}@${revision}`;
}

/** URL de um caminho relativo à working copy do projeto, presa à revisão. */
export function projectPathUrl(project: Project, relativePath: string, revision: number): string {
  return repoPathUrl(project, repoPathOf(project, relativePath), revision);
}
