import type { Project, RevertItem, RevertRequest } from '@shared/types.ts';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useOperationRun, useRevertPreview } from '@/lib/queries';
import { displayPath, statusLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import { CommandBlock, LockNotice } from './ConfirmDialog';
import { OperationProgress } from './OperationProgress';
import { Placeholder } from './Placeholder';

function ItemRow({ item }: { item: RevertItem }) {
  const status = statusLabel(item);
  return (
    <li
      className="flex gap-2 font-mono text-xs"
      title={[status.label, item.included && 'dentro de uma pasta que volta inteira']
        .filter(Boolean)
        .join('; ')}
    >
      <span className={cn('w-3 shrink-0', status.className)}>{status.letter}</span>
      <span className={cn('truncate', item.included && 'text-muted-foreground')}>
        {displayPath(item)}
      </span>
      {item.included && (
        <span className="text-muted-foreground shrink-0 font-sans text-[11px] italic">
          conteúdo
        </span>
      )}
      {item.item === 'added' && !item.included && (
        <span className="text-muted-foreground shrink-0 font-sans text-[11px] italic">
          fica no disco, não versionado
        </span>
      )}
    </li>
  );
}

interface RevertDialogProps {
  request: RevertRequest;
  projects: Project[];
  locked: boolean;
  onUnlock: () => void;
  onClose: () => void;
}

/**
 * Confirmação do revert: lista final por projeto (com o que volta junto com pastas), aviso de
 * que as mudanças se perdem e os comandos exatos. Depois de confirmar, mostra a saída ao vivo.
 */
export function RevertDialog({ request, projects, locked, onUnlock, onClose }: RevertDialogProps) {
  const preview = useRevertPreview(request);
  const run = useOperationRun(
    (fingerprint: string) => api.startRevert(request, fingerprint),
    () => {},
  );

  const byId = new Map(projects.map((p) => [p.id, p]));
  const data = preview.data;
  const total = data?.projects.reduce((sum, p) => sum + p.items.length, 0) ?? 0;
  const hasAdded = data?.projects.some((p) => p.items.some((i) => i.item === 'added')) ?? false;
  const blocked = !data || data.errors.length > 0 || data.commands.length === 0 || locked;

  return (
    <Dialog open onOpenChange={(next) => !next && !run.busy && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reverter</DialogTitle>
          <DialogDescription>
            {!run.started
              ? 'Confira a lista e os comandos antes de confirmar.'
              : 'Saída do svn em tempo real.'}
          </DialogDescription>
        </DialogHeader>

        {run.started ? (
          <OperationProgress
            operation={run.operation}
            projects={projects}
            doneMessage="Revert concluído."
          />
        ) : preview.isPending ? (
          <Placeholder>
            <Loader2 className="size-5 animate-spin" />
            Montando a lista…
          </Placeholder>
        ) : preview.isError ? (
          <p className="text-destructive text-sm">{preview.error.message}</p>
        ) : (
          <div className="space-y-3">
            {total > 0 && (
              <p className="bg-warning text-warning-foreground flex items-start gap-1.5 rounded-md px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  As mudanças locais destes itens voltam para a versão da base e se perdem: o svn
                  não guarda cópia.
                  {hasAdded && ' Item adicionado deixa de ser versionado, mas fica no disco.'}
                </span>
              </p>
            )}
            {data!.projects.map((p) => (
              <div key={p.projectId} className="space-y-1 rounded-md border p-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{byId.get(p.projectId)?.name}</span>
                  <span className="text-muted-foreground text-xs">{p.items.length}</span>
                </div>
                <ul className="max-h-40 overflow-y-auto">
                  {p.items.map((item) => (
                    <ItemRow key={item.path} item={item} />
                  ))}
                </ul>
              </div>
            ))}
            {data!.errors.length > 0 && (
              <ul className="text-destructive list-disc space-y-0.5 pl-5 text-sm">
                {data!.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            {data!.commands.length > 0 && <CommandBlock commands={data!.commands} />}
            {locked && <LockNotice kind="local" onUnlock={onUnlock} />}
            {run.startError && <p className="text-destructive text-sm">{run.startError.message}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {!run.started ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => run.start(data!.fingerprint)}
                disabled={blocked || run.starting}
              >
                {run.starting
                  ? 'Iniciando…'
                  : `Reverter (${total} ${total === 1 ? 'item' : 'itens'})`}
              </Button>
            </>
          ) : (
            <Button onClick={onClose} disabled={run.busy}>
              Fechar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
