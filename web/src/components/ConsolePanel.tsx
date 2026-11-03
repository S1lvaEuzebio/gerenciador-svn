import type { ConsoleEntry } from '@shared/types.ts';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { keys, useConsole } from '@/lib/queries';
import { cn } from '@/lib/utils';

function EntryRow({ entry }: { entry: ConsoleEntry }) {
  const [open, setOpen] = useState(false);
  const running = entry.exitCode === null && entry.durationMs === null;
  const failed = !running && entry.exitCode !== 0;
  const time = new Date(entry.startedAt).toLocaleTimeString('pt-BR');

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="hover:bg-accent/50 flex w-full items-baseline gap-3 px-3 py-1 text-left font-mono text-xs"
      >
        <span className="text-muted-foreground shrink-0">{time}</span>
        <span
          className={cn(
            'w-8 shrink-0 text-right',
            running ? 'text-muted-foreground' : failed ? 'text-destructive' : 'text-green-600',
          )}
        >
          {running ? '…' : (entry.exitCode ?? 'erro')}
        </span>
        <span className="min-w-0 flex-1 truncate">{entry.command}</span>
        {entry.durationMs !== null && (
          <span className="text-muted-foreground shrink-0">{entry.durationMs} ms</span>
        )}
      </button>
      {open && (
        <div className="bg-muted/40 px-3 py-2 font-mono text-xs">
          <div className="mb-1 break-all select-all">{entry.command}</div>
          {entry.stderr && (
            <pre className="text-destructive max-h-40 overflow-auto whitespace-pre-wrap">
              {entry.stderr}
            </pre>
          )}
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap">
            {entry.stdout || '(sem saída)'}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Painel inferior com todos os comandos svn que o app executou. */
export function ConsolePanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const entries = useConsole(true);
  const newestFirst = [...(entries.data ?? [])].reverse();

  const clear = async () => {
    await api.clearConsole();
    await queryClient.invalidateQueries({ queryKey: keys.console });
  };

  return (
    <div className="flex h-60 min-h-0 flex-col border-t">
      <div className="flex items-center gap-2 border-b px-3 py-1">
        <span className="text-sm font-medium">Console</span>
        <span className="text-muted-foreground text-xs">{newestFirst.length} comandos</span>
        <div className="flex-1" />
        <Button variant="ghost" size="xs" onClick={clear}>
          <Trash2 />
          Limpar
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Fechar console">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {newestFirst.length === 0 && (
          <p className="text-muted-foreground px-3 py-2 text-sm">Nenhum comando executado.</p>
        )}
        {newestFirst.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
