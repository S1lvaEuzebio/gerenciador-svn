import type { AppConfig } from '../shared/schema.ts';
import type { IncomingChange, Project, ProjectRemoteStatus } from '../shared/types.ts';
import { projectIgnoreMatcher } from './ignore.ts';
import { isChange, nodeKind } from './local-status.ts';
import { relativeToProject } from './projects.ts';
import { svnRemoteStatus } from './svn/status.ts';

/** O que vai chegar do servidor no próximo update (`svn status -u`). */
export async function projectRemoteStatus(
  project: Project,
  config: AppConfig,
): Promise<ProjectRemoteStatus> {
  try {
    const isIgnored = projectIgnoreMatcher(config, project.id);
    const { against, entries } = await svnRemoteStatus(project.id);
    const remote = entries.filter((e) => e.remote !== null);
    const paths = remote.map((e) => relativeToProject(project, e.path));
    const changes = await Promise.all(
      remote.map(async (entry, i): Promise<IncomingChange> => {
        const path = paths[i]!;
        // Pasta nova no servidor ainda não existe no disco: é pasta se tiver filhos na lista.
        const local = await nodeKind(entry.path);
        const kind =
          local !== 'unknown' ? local : paths.some((p) => p.startsWith(`${path}/`)) ? 'dir' : local;
        return {
          path,
          kind,
          item: entry.remote!.item,
          props: entry.remote!.props,
          localChange: isChange(entry),
          ignored: isIgnored(path),
        };
      }),
    );
    // Pasta "modificada" sem propriedade alterada só ganhou ou perdeu filhos, que já estão na lista.
    const incoming = changes.filter(
      (c) => !(c.kind === 'dir' && c.item === 'modified' && !c.props),
    );
    incoming.sort((a, b) => a.path.localeCompare(b.path));
    return { projectId: project.id, headRevision: against, incoming };
  } catch (error) {
    return {
      projectId: project.id,
      headRevision: null,
      incoming: [],
      error: (error as Error).message,
    };
  }
}
