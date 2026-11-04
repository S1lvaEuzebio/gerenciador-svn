import type { ReadOnlyConfig } from './schema.ts';

/** Nome de cada trava do modo somente leitura, como aparece para o usuário. */
export const LOCK_LABELS: Record<keyof ReadOnlyConfig, string> = {
  local: 'operações locais',
  commit: 'commit',
};
