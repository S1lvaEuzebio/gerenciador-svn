import type { ChangedPath, HistoryFilters, RepoNode } from './types.ts';

export const NO_FILTERS: HistoryFilters = { author: '', text: '' };

export function hasFilters(filters: HistoryFilters): boolean {
  return filters.author.trim() !== '' || filters.text.trim() !== '';
}

/**
 * Os dois lados do diff do que a revisão mudou num caminho. Esquerda: a origem da cópia, a
 * revisão anterior ou nada (caminho novo). Direita: a própria revisão ou nada (apagado).
 */
export function changeSides(
  change: ChangedPath,
  revision: number,
): [RepoNode | null, RepoNode | null] {
  const left =
    change.copyFrom ??
    (change.action === 'A' ? null : { path: change.path, revision: revision - 1 });
  return [left, change.action === 'D' ? null : { path: change.path, revision }];
}
