import type { Project, UpdatePreviewProject } from '@shared/types.ts';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useOperationRun, useUpdatePreview } from '@/lib/queries';
import { displayPath, incomingLabel } from '@/lib/status';
import { cn, firstLine, formatDate, projectCount } from '@/lib/utils';
import { CommandBlock, LockNotice } from './ConfirmDialog';
import { OperationProgress } from './OperationProgress';
import { Placeholder } from './Placeholder';

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ex.: "vendas (5 projetos)". */
  scopeLabel: string;
  projects: Project[];
  locked: boolean;
  onUnlock: () => void;
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="text-warning-foreground bg-warning flex items-start gap-1.5 rounded px-2 py-1 text-xs">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ProjectPreview({ project, item }: { project: Project; item: UpdatePreviewProject }) {
  const ignored = item.incoming.filter((c) => c.ignored);
  const local = item.incoming.filter((c) => c.localChange);
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{project.name}</span>
        {item.headRevision !== null && (
          <span className="text-muted-foreground font-mono text-xs">
            r{item.fromRevision} → r{item.headRevision}
          </span>
        )}
      </div>
      {item.error && <p className="text-destructive text-xs">{item.error}</p>}
      {ignored.length > 0 && (
        <Warning>
          Arquivos ignorados vão receber mudança: {ignored.map((c) => c.path).join(', ')}
        </Warning>
      )}
      {local.length > 0 && (
        <Warning>
          Também alterados localmente (o svn mescla o que der e marca conflito no resto):{' '}
          {local.map((c) => displayPath(c)).join(', ')}
        </Warning>
      )}
      {item.revisions.length > 0 && (
        <ul className="space-y-0.5">
          {item.revisions.map((r) => (
            <li key={r.revision} className="flex gap-2 text-xs" title={r.message}>
              <span className="shrink-0 font-mono">r{r.revision}</span>
              <span className="text-muted-foreground shrink-0">{r.author}</span>
              <span className="text-muted-foreground shrink-0">{formatDate(r.date)}</span>
              <span className="truncate">{firstLine(r.message)}</span>
            </li>
          ))}
        </ul>
      )}
      {item.revisionsTruncated && (
        <p className="text-muted-foreground text-xs">
          Lista cortada: mostra só as revisões mais recentes. O update traz todas até r
          {item.headRevision}.
        </p>
      )}
      <ul className="max-h-40 overflow-y-auto">
        {item.incoming.map((change) => {
          const status = incomingLabel(change);
          return (
            <li key={change.path} className="flex gap-2 font-mono text-xs" title={status.label}>
              <span className={cn('w-3 shrink-0', status.className)}>{status.letter}</span>
              <span className={cn('truncate', change.ignored && 'opacity-60')}>
                {displayPath(change)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Update com prévia: consulta o servidor, mostra revisões, arquivos, avisos e os comandos
 * exatos; só roda depois de confirmar. Cada working copy roda na sua fila, em paralelo.
 */
export function UpdateDialog({
  open,
  onOpenChange,
  scopeLabel,
  projects,
  locked,
  onUnlock,
}: UpdateDialogProps) {
  const preview = useUpdatePreview(projects.map((p) => p.id));
  // Ao terminar, o hook recarrega projetos (revisão), status local e o que ainda falta chegar.
  const run = useOperationRun(api.startUpdate, () => {});

  const items = preview.data?.projects ?? [];
  const withChanges = items.filter((i) => i.command !== null);
  const unchanged = items.filter((i) => i.command === null && !i.error);
  const errors = items.filter((i) => i.command === null && i.error);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const confirm = () =>
    run.start(withChanges.map((i) => ({ projectId: i.projectId, revision: i.headRevision! })));

  return (
    <Dialog open={open} onOpenChange={(next) => !run.busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Update: {scopeLabel}</DialogTitle>
          <DialogDescription>
            {!run.started
              ? 'Confira o que vai chegar do servidor antes de confirmar.'
              : 'Saída do svn em tempo real.'}
          </DialogDescription>
        </DialogHeader>

        {run.started ? (
          <OperationProgress
            operation={run.operation}
            projects={projects}
            doneMessage="Update concluído. Conflitos, se houver, aparecem com C na lista Locais."
          />
        ) : preview.isPending ? (
          <Placeholder>
            <Loader2 className="size-5 animate-spin" />
            Consultando o servidor…
          </Placeholder>
        ) : preview.isError ? (
          <p className="text-destructive text-sm">{preview.error.message}</p>
        ) : (
          <div className="space-y-3">
            {withChanges.length === 0 && (
              <p className="text-muted-foreground text-sm">Nada para receber do servidor.</p>
            )}
            {withChanges.map((item) => (
              <ProjectPreview
                key={item.projectId}
                project={byId.get(item.projectId)!}
                item={item}
              />
            ))}
            {errors.map((item) => (
              <p key={item.projectId} className="text-destructive text-xs">
                {byId.get(item.projectId)?.name}: {item.error}
              </p>
            ))}
            {unchanged.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Sem novidades: {unchanged.map((i) => byId.get(i.projectId)?.name).join(', ')}
              </p>
            )}
            {withChanges.length > 0 && (
              <CommandBlock commands={withChanges.map((i) => i.command!)} />
            )}
            {locked && withChanges.length > 0 && <LockNotice kind="local" onUnlock={onUnlock} />}
            {run.startError && <p className="text-destructive text-sm">{run.startError.message}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {!run.started ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={confirm}
                disabled={withChanges.length === 0 || locked || run.starting}
              >
                {run.starting ? 'Iniciando…' : `Fazer update (${projectCount(withChanges.length)})`}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)} disabled={run.busy}>
              Fechar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
