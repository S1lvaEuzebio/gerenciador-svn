import { useEffect, useState } from 'react';

/** Valor que só acompanha `value` depois de `delay` ms sem mudar (ex.: filtro digitado). */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
