import type { CommitItem, CommitRequest, Project } from '@shared/types.ts';
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
import { useCommitPreview, useOperationRun } from '@/lib/queries';
import { commitActionLabel, displayPath } from '@/lib/status';
import { cn } from '@/lib/utils';
import { CommandBlock, LockNotice } from './ConfirmDialog';
import { OperationProgress } from './OperationProgress';
import { Placeholder } from './Placeholder';

const INCLUDED: Record<NonNullable<CommitItem['included']>, string> = {
  parent: 'pasta nova acima de um item marcado',
  content: 'dentro de uma pasta marcada',
};

function ItemRow({ item }: { item: CommitItem }) {
  const action = commitActionLabel(item.action);
  return (
    <li
      className="flex gap-2 font-mono text-xs"
      title={[action.label, item.included && INCLUDED[item.included]].filter(Boolean).join('; ')}
    >
      <span className={cn('w-3 shrink-0', action.className)}>{action.letter}</span>
      <span className={cn('truncate', item.included && 'text-muted-foreground')}>
        {displayPath(item)}
      </span>
      {item.included && (
        <span className="text-muted-foreground shrink-0 font-sans text-[11px] italic">
          {item.included === 'parent' ? 'incluída' : 'conteúdo'}
        </span>
      )}
    </li>
  );
}

interface CommitDialogProps {
  request: CommitRequest;
  projects: Project[];
  locked: boolean;
  onUnlock: () => void;
  onClose: () => void;
  /** Abre o update dos projetos com itens desatualizados (a seleção continua marcada). */
  onUpdate: (projectIds: string[]) => void;
  /** Commit feito: limpa a seleção e guarda a mensagem no histórico. */
  onCommitted: (message: string) => void;
}

/**
 * Confirmação do commit: lista final por projeto (com o que entra automaticamente), checagem
 * de desatualizados e os comandos exatos. Depois de confirmar, mostra a saída ao vivo.
 */
export function CommitDialog({
  request,
  projects,
  locked,
  onUnlock,
  onClose,
  onUpdate,
  onCommitted,
}: CommitDialogProps) {
  const preview = useCommitPreview(request);
  const run = useOperationRun(
    (fingerprint: string) => api.startCommit(request, fingerprint),
    (succeeded) => succeeded && onCommitted(request.message),
  );

  const byId = new Map(projects.map((p) => [p.id, p]));
  const data = preview.data;
  const total = data?.projects.reduce((sum, p) => sum + p.items.length, 0) ?? 0;
  const outdated = data?.projects.filter((p) => p.outdated.length > 0) ?? [];
  const blocked = !data || data.errors.length > 0 || outdated.length > 0 || locked;

  return (
    <Dialog open onOpenChange={(next) => !next && !run.busy && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Commit</DialogTitle>
          <DialogDescription>
            {!run.started
              ? 'Confira a lista final e os comandos antes de confirmar.'
              : 'Saída do svn em tempo real.'}
          </DialogDescription>
        </DialogHeader>

        {run.started ? (
          <OperationProgress
            operation={run.operation}
            projects={projects}
            doneMessage="Commit feito. A seleção e o rascunho foram limpos."
          />
        ) : preview.isPending ? (
          <Placeholder>
            <Loader2 className="size-5 animate-spin" />
            Montando a lista e consultando o servidor…
          </Placeholder>
        ) : preview.isError ? (
          <p className="text-destructive text-sm">{preview.error.message}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-muted-foreground text-xs font-medium uppercase">Mensagem</div>
              <pre className="bg-muted rounded-md px-3 py-2 text-sm whitespace-pre-wrap">
                {request.message}
              </pre>
            </div>
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
            {outdated.length > 0 && (
              <div className="bg-warning text-warning-foreground space-y-2 rounded-md px-3 py-2 text-sm">
                <p className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Mudaram no servidor depois do seu último update; faça update antes de comitar:{' '}
                    {outdated
                      .flatMap((p) =>
                        p.outdated.map((path) => `${byId.get(p.projectId)?.name}/${path}`),
                      )
                      .join(', ')}
                  </span>
                </p>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onUpdate(outdated.map((p) => p.projectId))}
                >
                  Fazer update desses projetos
                </Button>
              </div>
            )}
            {data!.errors.length > 0 && (
              <ul className="text-destructive list-disc space-y-0.5 pl-5 text-sm">
                {data!.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            <CommandBlock commands={data!.commands} />
            {locked && <LockNotice kind="commit" onUnlock={onUnlock} />}
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
                onClick={() => run.start(data!.fingerprint)}
                disabled={blocked || run.starting}
              >
                {run.starting
                  ? 'Iniciando…'
                  : `Comitar (${total} ${total === 1 ? 'item' : 'itens'})`}
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
