import type { Operation, OperationStep, Project, UpdatePreviewProject } from '@shared/types.ts';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useOperation, useRefreshAll, useUpdatePreview } from '@/lib/queries';
import { displayPath, incomingLabel } from '@/lib/status';
import { cn, projectCount } from '@/lib/utils';
import { CommandBlock, LockNotice } from './ConfirmDialog';
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

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function firstLine(text: string): string {
  return text.split('\n', 1)[0] ?? '';
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
              <span className="text-muted-foreground shrink-0">
                {r.date && dateFormat.format(new Date(r.date))}
              </span>
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

const STEP_ICON = {
  queued: <Circle className="text-muted-foreground size-4" />,
  running: <Loader2 className="size-4 animate-spin" />,
  done: <CheckCircle2 className="size-4 text-green-600" />,
  failed: <XCircle className="text-destructive size-4" />,
};

function StepOutput({ step, project }: { step: OperationStep; project: Project | undefined }) {
  const ref = useRef<HTMLPreElement>(null);
  // Caminhos absolutos ficam longos; na tela o projeto aparece pelo nome.
  const output = project ? step.output.replaceAll(project.id, project.name) : step.output;
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [output]);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium">
        {STEP_ICON[step.state]}
        {project?.name ?? step.projectId}
      </div>
      <pre
        ref={ref}
        className="bg-muted max-h-48 overflow-auto rounded-md px-3 py-2 font-mono text-xs whitespace-pre-wrap"
      >
        {output || (step.state === 'queued' ? 'na fila…' : '…')}
      </pre>
    </div>
  );
}

function Progress({
  operation,
  projects,
}: {
  operation: Operation | undefined;
  projects: Project[];
}) {
  if (!operation) return <Placeholder>Iniciando…</Placeholder>;
  const failed = operation.steps.filter((s) => s.state === 'failed').length;
  return (
    <div className="space-y-3">
      {operation.steps.map((step) => (
        <StepOutput
          key={step.projectId}
          step={step}
          project={projects.find((p) => p.id === step.projectId)}
        />
      ))}
      {operation.done && (
        <p className={cn('text-sm', failed > 0 ? 'text-destructive' : 'text-muted-foreground')}>
          {failed > 0
            ? `Terminou com falha em ${failed} projeto(s). Veja a saída acima.`
            : 'Update concluído. Conflitos, se houver, aparecem com C na lista Locais.'}
        </p>
      )}
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
  const [operationId, setOperationId] = useState<number | null>(null);
  const preview = useUpdatePreview(projects.map((p) => p.id));
  const operation = useOperation(operationId);
  const start = useMutation({
    mutationFn: api.startUpdate,
    onSuccess: (op) => setOperationId(op.id),
  });
  const done = operation.data?.done ?? false;
  const running = operationId !== null && !done;

  // Ao terminar, recarrega projetos (revisão), status local e o que ainda falta chegar.
  const refreshAll = useRefreshAll();
  const onDone = useEffectEvent(() => void refreshAll());
  useEffect(() => {
    if (done) onDone();
  }, [done]);

  const items = preview.data?.projects ?? [];
  const withChanges = items.filter((i) => i.command !== null);
  const unchanged = items.filter((i) => i.command === null && !i.error);
  const errors = items.filter((i) => i.command === null && i.error);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const confirm = () =>
    start.mutate(withChanges.map((i) => ({ projectId: i.projectId, revision: i.headRevision! })));

  return (
    // Durante o update a janela não fecha: a saída e a recarga do status dependem dela.
    <Dialog open={open} onOpenChange={(next) => !running && !start.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Update: {scopeLabel}</DialogTitle>
          <DialogDescription>
            {operationId === null
              ? 'Confira o que vai chegar do servidor antes de confirmar.'
              : 'Saída do svn em tempo real.'}
          </DialogDescription>
        </DialogHeader>

        {operationId !== null ? (
          <Progress operation={operation.data} projects={projects} />
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
            {locked && withChanges.length > 0 && <LockNotice onUnlock={onUnlock} />}
            {start.error && <p className="text-destructive text-sm">{start.error.message}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {operationId === null ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={confirm}
                disabled={withChanges.length === 0 || locked || start.isPending}
              >
                {start.isPending
                  ? 'Iniciando…'
                  : `Fazer update (${projectCount(withChanges.length)})`}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)} disabled={running}>
              Fechar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
