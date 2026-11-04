import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Comandos svn exatos que a operação vai rodar, para conferir antes de confirmar. */
export function CommandBlock({ commands }: { commands: string[] }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs font-medium uppercase">
        {commands.length > 1 ? 'Comandos' : 'Comando'}
      </div>
      <pre className="bg-muted max-h-40 overflow-auto rounded-md px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap select-all">
        {commands.join('\n')}
      </pre>
    </div>
  );
}

/** Aviso de que o modo somente leitura trava as operações locais, com atalho para destravar. */
export function LockNotice({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="bg-warning text-warning-foreground flex items-center gap-2 rounded-md px-3 py-2 text-sm">
      <Lock className="size-4 shrink-0" />
      <span className="flex-1">Operações locais travadas pelo modo somente leitura.</span>
      <Button variant="outline" size="xs" onClick={onUnlock}>
        Destravar…
      </Button>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  command: string;
  confirmLabel: string;
  /** Descarta mudanças (arquivo inteiro): botão vermelho. */
  destructive?: boolean;
  pending: boolean;
  error: Error | null;
  onConfirm: () => void;
}

/** Confirmação de uma operação de gravação: o que vai acontecer e o comando exato. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  command,
  confirmLabel,
  destructive = false,
  pending,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">{description}</div>
          </DialogDescription>
        </DialogHeader>
        <CommandBlock commands={[command]} />
        {error && <p className="text-destructive text-sm">{error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Executando…' : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
