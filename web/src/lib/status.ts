import type { LocalChange } from '@shared/types.ts';

export interface StatusLabel {
  letter: string;
  label: string;
  className: string;
}

const ITEM_LABELS: Partial<Record<LocalChange['item'], StatusLabel>> = {
  modified: { letter: 'M', label: 'modificado', className: 'text-amber-600 dark:text-amber-400' },
  added: { letter: 'A', label: 'adicionado', className: 'text-green-600 dark:text-green-400' },
  deleted: { letter: 'D', label: 'apagado', className: 'text-red-600 dark:text-red-400' },
  replaced: { letter: 'R', label: 'substituído', className: 'text-blue-600 dark:text-blue-400' },
  unversioned: { letter: '?', label: 'não versionado', className: 'text-muted-foreground' },
  missing: { letter: '!', label: 'faltando no disco', className: 'text-red-600 dark:text-red-400' },
  conflicted: {
    letter: 'C',
    label: 'em conflito',
    className: 'text-red-600 dark:text-red-400 font-bold',
  },
  obstructed: { letter: '~', label: 'obstruído', className: 'text-red-600 dark:text-red-400' },
  incomplete: { letter: 'I', label: 'incompleto', className: 'text-red-600 dark:text-red-400' },
};

const PROPS_MODIFIED: StatusLabel = {
  letter: 'P',
  label: 'propriedades alteradas',
  className: 'text-violet-600 dark:text-violet-400',
};

const TREE_CONFLICT: StatusLabel = {
  letter: 'T',
  label: 'conflito de árvore',
  className: 'text-red-600 dark:text-red-400 font-bold',
};

export function statusLabel(change: LocalChange): StatusLabel {
  if (change.treeConflict) return TREE_CONFLICT;
  const item = ITEM_LABELS[change.item];
  if (item) return item;
  if (change.props === 'conflicted') return ITEM_LABELS.conflicted!;
  return PROPS_MODIFIED;
}

export function isConflict(change: LocalChange): boolean {
  return change.item === 'conflicted' || change.props === 'conflicted' || change.treeConflict;
}

/** Só mudança de propriedade, sem mudança de conteúdo. */
export function isPropsOnly(change: LocalChange): boolean {
  return (change.item === 'normal' || change.item === 'none') && change.props === 'modified';
}

export function displayPath(change: LocalChange): string {
  const base = change.path === '' ? '(pasta do projeto)' : change.path;
  return change.kind === 'dir' && change.path !== '' ? `${base}/` : base;
}
