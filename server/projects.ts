import { readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Project, ProjectsResponse, RootError } from '../shared/types.ts';
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
