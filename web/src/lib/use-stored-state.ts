import { useState } from 'react';
import { readStored, writeStored } from './utils';

/** Estado de preferência (aba, modo de visualização) lembrado no navegador. */
export function useStoredState<T extends string>(
  key: string,
  initial: T,
  isValid: (value: string) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(key);
    return stored !== null && isValid(stored) ? stored : initial;
  });
  const update = (next: T) => {
    setValue(next);
    writeStored(key, next);
  };
  return [value, update];
}
