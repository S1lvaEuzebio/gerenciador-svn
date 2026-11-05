import type { CleanupPreview, Operation, Project } from '../shared/types.ts';
import { startOperation } from './operations.ts';
import { localTarget, svnCommandLine } from './svn/run.ts';

/**
 * `svn cleanup` simples: tira travas e termina operações interrompidas. Nunca com
 * `--remove-unversioned` ou `--remove-ignored`, que apagam arquivos.
 */
function cleanupArgs(project: Project): string[] {
  return ['cleanup', localTarget(project.id)];
}

/** Comandos exatos do cleanup, para a confirmação. */
export function cleanupPreview(projects: Project[]): CleanupPreview {
  return { commands: projects.map((p) => svnCommandLine(cleanupArgs(p))) };
}

/** Cleanup de cada projeto na fila da sua working copy, em paralelo entre elas. */
export function startCleanup(projects: Project[]): Operation {
  return startOperation(
    'Cleanup',
    projects.map((p) => ({ label: p.name, projectIds: [p.id], args: cleanupArgs(p) })),
    'parallel',
  );
}
