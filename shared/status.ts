import type { ItemStatus, PropStatus } from './types.ts';

/** Estado de um caminho no `svn status`, do jeito que servidor e tela guardam. */
interface NodeStatus {
  item: ItemStatus;
  props: PropStatus;
  treeConflict: boolean;
}

/** Conflito de conteúdo, de propriedade ou de árvore. */
export function isConflicted(node: NodeStatus): boolean {
  return node.item === 'conflicted' || node.props === 'conflicted' || node.treeConflict;
}

/** Só mudança de propriedade, sem mudança de conteúdo. */
export function isPropsOnly(node: Pick<NodeStatus, 'item' | 'props'>): boolean {
  return (node.item === 'normal' || node.item === 'none') && node.props === 'modified';
}

/** O revert não mexe em arquivo não versionado (nem o apaga): fica de fora. */
export function isRevertable(node: { item: ItemStatus }): boolean {
  return node.item !== 'unversioned';
}
