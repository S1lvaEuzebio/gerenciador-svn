import { createHash } from 'node:crypto';
import type { NodeKind, Project } from '../shared/types.ts';
import { HttpError } from './http-error.ts';
import type { StepSpec } from './operations.ts';
import { relativeToProject, requireProjects, resolveInProject } from './projects.ts';
import { svnTree } from './svn/info.ts';

/** Ordem por código, para a pasta vir sempre antes do que tem dentro (`a` < `a/b`). */
export const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export const isInside = (path: string, folder: string) => path.startsWith(`${folder}/`);

/** Caminho nas mensagens de erro: `projeto/caminho`, ou só o projeto para a pasta raiz. */
export const itemLabel = (project: Project, path: string) =>
  path === '' ? project.name : `${project.name}/${path}`;

/** Caminhos pedidos pela tela, agrupados por projeto (só projetos descobertos). */
export async function groupByProject(
  items: Array<{ projectId: string; path: string }>,
): Promise<Array<{ project: Project; paths: string[] }>> {
  const pathsByProject = new Map<string, string[]>();
  for (const { projectId, path } of items) {
    pathsByProject.set(projectId, [...(pathsByProject.get(projectId) ?? []), path]);
  }
  const projects = await requireProjects([...pathsByProject.keys()]);
  return projects.map((project) => ({ project, paths: pathsByProject.get(project.id)! }));
}

/**
 * Tudo o que o svn conhece dentro de uma pasta, inclusive apagado ou faltando no disco (o
 * status não lista o conteúdo de pasta apagada ou faltando), relativo ao projeto.
 */
export async function folderTree(
  project: Project,
  folder: string,
): Promise<Array<{ path: string; kind: NodeKind }>> {
  return (await svnTree(resolveInProject(project, folder)))
    .map((node) => ({ ...node, path: relativeToProject(project, node.path) }))
    .filter((node) => isInside(node.path, folder));
}

/** Plano de uma operação de gravação: o que a prévia mostra e as etapas que rodam. */
export interface Planned {
  errors: string[];
  fingerprint: string;
  specs: StepSpec[];
}

/**
 * Identifica um plano pelo que a confirmação mostra: comandos e lista final. A execução refaz
 * o plano e só segue se a impressão for a mesma da prévia, então nada roda sem ter aparecido
 * nela (nem o conteúdo de uma pasta que vai inteira).
 */
export function planFingerprint(commands: string[], items: unknown): string {
  return createHash('sha256').update(JSON.stringify({ commands, items })).digest('hex');
}

/** O que a prévia devolve: o plano sem as etapas internas. */
export function previewOf<T extends Planned>({ specs: _specs, ...preview }: T): Omit<T, 'specs'> {
  return preview;
}

/** Recusa a execução se o plano tem erro, não tem o que rodar ou mudou desde a prévia. */
export function requireSamePlan(plan: Planned, fingerprint: string, name: string): void {
  if (plan.errors.length > 0) throw new HttpError(400, plan.errors.join('; '));
  if (plan.specs.length === 0) throw new HttpError(400, `nada para o ${name} fazer`);
  if (plan.fingerprint !== fingerprint) {
    throw new HttpError(409, `a lista do ${name} mudou desde a prévia; confira de novo`);
  }
}
