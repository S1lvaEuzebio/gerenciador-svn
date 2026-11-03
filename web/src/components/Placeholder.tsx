import type { ReactNode } from 'react';

/** Mensagem centralizada para estados vazios, de carregamento e de erro. */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      {children}
    </div>
  );
}
