import { lstat } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import type { AppConfig } from '../shared/schema.ts';
import type { LocalChange, NodeKind, Project, ProjectStatus } from '../shared/types.ts';
import { projectIgnoreMatcher } from './ignore.ts';
import { svnStatus, type StatusEntry } from './svn/status.ts';

async function nodeKind(path: string): Promise<NodeKind> {
  try {
    const info = await lstat(path);
    return info.isDirectory() ? 'dir' : 'file';
  } catch {
    return 'unknown';
  }
}

/** Entradas que o `svn status` lista mas que não são mudança (ex.: externals). */
function isChange(entry: StatusEntry): boolean {
  if (entry.item === 'external') return false;
  if (entry.treeConflict) return true;
  if (entry.props === 'modified' || entry.props === 'conflicted') return true;
  return entry.item !== 'normal' && entry.item !== 'none';
}

export async function projectStatus(project: Project, config: AppConfig): Promise<ProjectStatus> {
  try {
    const isIgnored = projectIgnoreMatcher(config, project.id);
    const entries = (await svnStatus(project.id)).filter(isChange);
    const changes = await Promise.all(
      entries.map(async (entry): Promise<LocalChange> => {
        const path = relative(project.id, entry.path).split(sep).join('/');
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
