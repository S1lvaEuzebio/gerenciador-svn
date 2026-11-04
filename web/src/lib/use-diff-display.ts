import type { DiffMode } from '@/components/MergeEditor';
import { useStoredState } from './use-stored-state';

const isDiffMode = (value: string): value is DiffMode => value === 'split' || value === 'unified';
const isFlag = (value: string): value is 'on' | 'off' => value === 'on' || value === 'off';

/** Lado a lado/unificado e ignorar espaços: lembrados no navegador, valem para todos os diffs. */
export function useDiffDisplay() {
  const [mode, setMode] = useStoredState<DiffMode>('diff-mode', 'split', isDiffMode);
  const [whitespace, setWhitespace] = useStoredState<'on' | 'off'>('diff-ignore-ws', 'off', isFlag);
  return {
    mode,
    setMode,
    ignoreWhitespace: whitespace === 'on',
    setIgnoreWhitespace: (on: boolean) => setWhitespace(on ? 'on' : 'off'),
  };
}

export type DiffDisplay = ReturnType<typeof useDiffDisplay>;
