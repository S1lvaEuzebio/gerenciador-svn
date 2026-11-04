import { lstat } from 'node:fs/promises';
import type { AppConfig } from '../shared/schema.ts';
import type { LocalChange, NodeKind, Project, ProjectStatus } from '../shared/types.ts';
import { projectIgnoreMatcher } from './ignore.ts';
import { relativeToProject } from './projects.ts';
import { svnStatus, type StatusEntry } from './svn/status.ts';

export async function nodeKind(path: string): Promise<NodeKind> {
  try {
    const info = await lstat(path);
    return info.isDirectory() ? 'dir' : 'file';
  } catch {
    return 'unknown';
  }
}

/** Entradas que o `svn status` lista mas que não são mudança (ex.: externals). */
export function isChange(entry: StatusEntry): boolean {
  if (entry.item === 'external') return false;
  if (entry.treeConflict) return true;
  if (entry.props === 'modified' || entry.props === 'conflicted') return true;
  return entry.item !== 'normal' && entry.item !== 'none';
}

const CONFLICT_AUX = /^(.+)\.(?:mine|working|prej|r\d+|merge-(?:left|right)\.r\d+)$/;

/**
 * Arquivos que o svn grava ao lado de um item em conflito (`.mine`, `.rN`, `.prej`...). Somem ao
 * resolver; não entram na lista para não virarem "não versionados" a comitar.
 */
function isConflictAux(entry: StatusEntry, conflicted: Set<string>): boolean {
  const owner = entry.item === 'unversioned' ? CONFLICT_AUX.exec(entry.path)?.[1] : undefined;
  return owner !== undefined && conflicted.has(owner);
}

export async function projectStatus(project: Project, config: AppConfig): Promise<ProjectStatus> {
  try {
    const isIgnored = projectIgnoreMatcher(config, project.id);
    const all = (await svnStatus(project.id)).filter(isChange);
    const conflicted = new Set(
      all.filter((e) => e.item === 'conflicted' || e.props === 'conflicted').map((e) => e.path),
    );
    const entries = all.filter((e) => !isConflictAux(e, conflicted));
    const changes = await Promise.all(
      entries.map(async (entry): Promise<LocalChange> => {
        const path = relativeToProject(project, entry.path);
        return {
          path,
          kind: await nodeKind(entry.path),
          item: entry.item,
          props: entry.props,
          treeConflict: entry.treeConflict,
          ignored: isIgnored(path),
        };
      }),
    );
    changes.sort((a, b) => a.path.localeCompare(b.path));
    return { projectId: project.id, changes };
  } catch (error) {
    return { projectId: project.id, changes: [], error: (error as Error).message };
  }
}
