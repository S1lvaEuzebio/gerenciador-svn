import { isConflicted } from '@shared/status.ts';
import type { ChangeAction, CommitAction, IncomingChange, LocalChange } from '@shared/types.ts';

export { isPropsOnly } from '@shared/status.ts';

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

export function statusLabel(
  change: Pick<LocalChange, 'item' | 'props' | 'treeConflict'>,
): StatusLabel {
  if (change.treeConflict) return TREE_CONFLICT;
  const item = ITEM_LABELS[change.item];
  if (item) return item;
  if (change.props === 'conflicted') return ITEM_LABELS.conflicted!;
  return PROPS_MODIFIED;
}

export const isConflict = (change: LocalChange): boolean => isConflicted(change);

/** Pode ser marcado para o commit: ignorado nunca entra, conflito precisa ser resolvido antes. */
export function isCommittable(change: LocalChange): boolean {
  return !change.ignored && !isConflict(change);
}

/** Pode ser revertido: o revert não mexe em arquivo não versionado (nem o apaga). */
export function isRevertable(change: LocalChange): boolean {
  return change.item !== 'unversioned';
}

/** Chave de um item na seleção do commit. */
export function commitKey(projectId: string, path: string): string {
  return `${projectId}\n${path}`;
}

/** Caminho para mostrar na lista: pasta do projeto e pastas com `/` no fim. */
export function displayPath(change: Pick<LocalChange, 'path' | 'kind'>): string {
  const base = change.path === '' ? '(pasta do projeto)' : change.path;
  return change.kind === 'dir' && change.path !== '' ? `${base}/` : base;
}

const INCOMING_LABELS: Record<IncomingChange['item'], StatusLabel> = {
  added: { letter: 'A', label: 'novo no servidor', className: ITEM_LABELS.added!.className },
  deleted: { letter: 'D', label: 'apagado no servidor', className: ITEM_LABELS.deleted!.className },
  modified: {
    letter: 'M',
    label: 'alterado no servidor',
    className: ITEM_LABELS.modified!.className,
  },
  replaced: {
    letter: 'R',
    label: 'substituído no servidor',
    className: ITEM_LABELS.replaced!.className,
  },
  none: { ...PROPS_MODIFIED, label: 'propriedades alteradas no servidor' },
};

export function incomingLabel(change: IncomingChange): StatusLabel {
  return INCOMING_LABELS[change.item];
}

const COMMIT_LABELS: Record<CommitAction, StatusLabel> = {
  'to-add': { ...ITEM_LABELS.added!, label: 'novo: entra com svn add' },
  'to-delete': { ...ITEM_LABELS.deleted!, label: 'faltando no disco: entra com svn delete' },
  added: ITEM_LABELS.added!,
  deleted: ITEM_LABELS.deleted!,
  modified: ITEM_LABELS.modified!,
  replaced: ITEM_LABELS.replaced!,
  props: PROPS_MODIFIED,
};

export function commitActionLabel(action: CommitAction): StatusLabel {
  return COMMIT_LABELS[action];
}

const CHANGE_LABELS: Record<ChangeAction, StatusLabel> = {
  A: ITEM_LABELS.added!,
  D: ITEM_LABELS.deleted!,
  M: ITEM_LABELS.modified!,
  R: ITEM_LABELS.replaced!,
};

/** Ação de um caminho numa revisão do histórico. */
export function changeActionLabel(action: ChangeAction): StatusLabel {
  return CHANGE_LABELS[action];
}
