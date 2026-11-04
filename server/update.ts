import type { AppConfig } from '../shared/schema.ts';
import type {
  IncomingChange,
  Project,
  RevisionSummary,
  UpdatePreview,
  UpdatePreviewProject,
} from '../shared/types.ts';
import { startOperation } from './operations.ts';
import { repoUrl } from './projects.ts';
import { projectRemoteStatus } from './remote-status.ts';
import { svnInfo } from './svn/info.ts';
import { svnLog } from './svn/log.ts';
import { svnCommandLine } from './svn/run.ts';

const MAX_REVISIONS = 100;

/** Sempre até a revisão mostrada na prévia, e conflitos ficam para resolver na tela. */
function updateArgs(project: Project, revision: number): string[] {
  return ['update', '--accept', 'postpone', '-r', String(revision), project.id];
}

/**
 * Revisões entre a da working copy e a do servidor que mexem em algum caminho que vai chegar.
 * Filtrar pelos caminhos tira os commits do próprio usuário, que já estão na working copy
 * mesmo com a raiz numa revisão antiga.
 */
async function incomingRevisions(
  project: Project,
  fromRevision: number,
  headRevision: number,
  incoming: IncomingChange[],
): Promise<RevisionSummary[]> {
  if (fromRevision >= headRevision) return [];
  const base = project.relativeUrl.slice(1);
  const targets = incoming.map((c) => (c.path === '' ? base : `${base}/${c.path}`));
  const related = (path: string) =>
    targets.some((t) => t === path || t.startsWith(`${path}/`) || path.startsWith(`${t}/`));
  const log = await svnLog(
    repoUrl(project, '', headRevision),
    `${fromRevision + 1}:${headRevision}`,
    MAX_REVISIONS,
  );
  return log
    .filter((entry) => entry.paths.some(related))
    .map(({ revision, author, date, message }) => ({ revision, author, date, message }));
}

async function previewProject(project: Project, config: AppConfig): Promise<UpdatePreviewProject> {
  const remote = await projectRemoteStatus(project, config);
  const base = {
    projectId: project.id,
    fromRevision: project.revision,
    headRevision: remote.headRevision,
    incoming: remote.incoming,
    revisions: [],
    command: null,
  };
  if (remote.error || remote.headRevision === null) {
    return { ...base, error: remote.error ?? 'o svn não informou a revisão do servidor' };
  }
  if (remote.incoming.length === 0) return base;
  try {
    const { revision } = await svnInfo(project.id);
    return {
      ...base,
      fromRevision: revision,
      revisions: await incomingRevisions(project, revision, remote.headRevision, remote.incoming),
      command: svnCommandLine(updateArgs(project, remote.headRevision)),
    };
  } catch (error) {
    return { ...base, error: (error as Error).message };
  }
}

export async function updatePreview(
  projects: Project[],
  config: AppConfig,
): Promise<UpdatePreview> {
  return { projects: await Promise.all(projects.map((p) => previewProject(p, config))) };
}

export function startUpdate(targets: Array<{ project: Project; revision: number }>) {
  return startOperation(
    'Update',
    targets.map(({ project, revision }) => ({
      projectId: project.id,
      args: updateArgs(project, revision),
    })),
  );
}
