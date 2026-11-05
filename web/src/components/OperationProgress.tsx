import type { Operation, OperationStep, Project } from '@shared/types.ts';
import { CheckCircle2, Circle, CircleSlash, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Placeholder } from './Placeholder';

const STEP_ICON = {
  queued: <Circle className="text-muted-foreground size-4" />,
  running: <Loader2 className="size-4 animate-spin" />,
  done: <CheckCircle2 className="size-4 text-green-600" />,
  failed: <XCircle className="text-destructive size-4" />,
  skipped: <CircleSlash className="text-muted-foreground size-4" />,
};

const PENDING_TEXT: Partial<Record<OperationStep['state'], string>> = {
  queued: 'na fila…',
  running: '…',
  skipped: 'não executado: a etapa anterior falhou',
};

function StepOutput({ step, projects }: { step: OperationStep; projects: Project[] }) {
  const ref = useRef<HTMLPreElement>(null);
  // Caminhos absolutos ficam longos; na tela cada projeto aparece pelo nome. O commit mostra os
  // caminhos sem a barra inicial, por isso as duas formas.
  const output = projects.reduce(
    (text, p) => text.replaceAll(p.id, p.name).replaceAll(p.id.slice(1), p.name),
    step.output,
  );
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [output]);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium">
        {STEP_ICON[step.state]}
        {step.label}
      </div>
      <pre
        ref={ref}
        className="bg-muted max-h-48 overflow-auto rounded-md px-3 py-2 font-mono text-xs whitespace-pre-wrap"
      >
        {output || PENDING_TEXT[step.state]}
      </pre>
    </div>
  );
}

/** Saída ao vivo de uma operação de gravação, etapa por etapa. */
export function OperationProgress({
  operation,
  projects,
  doneMessage,
}: {
  operation: Operation | undefined;
  projects: Project[];
  /** Mensagem quando todas as etapas dão certo. */
  doneMessage: string;
}) {
  if (!operation) return <Placeholder>Iniciando…</Placeholder>;
  const failed = operation.steps.some((s) => s.state === 'failed');
  return (
    <div className="space-y-3">
      {operation.steps.map((step, i) => (
        <StepOutput key={i} step={step} projects={projects} />
      ))}
      {operation.done && (
        <p className={cn('text-sm', failed ? 'text-destructive' : 'text-muted-foreground')}>
          {failed ? 'Terminou com falha. Veja a saída acima.' : doneMessage}
        </p>
      )}
    </div>
  );
}

/**
 * Rodapé das janelas de operação: Cancelar e confirmar antes de rodar; depois, Fechar, que só
 * libera quando o svn termina.
 */
export function OperationActions({
  run,
  onClose,
  confirmLabel,
  confirmDisabled,
  destructive = false,
  onConfirm,
}: {
  run: { started: boolean; starting: boolean; busy: boolean };
  onClose: () => void;
  confirmLabel: string;
  confirmDisabled: boolean;
  /** Descarta mudanças (revert): botão vermelho. */
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      {!run.started ? (
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={confirmDisabled || run.starting}
          >
            {run.starting ? 'Iniciando…' : confirmLabel}
          </Button>
        </>
      ) : (
        <Button onClick={onClose} disabled={run.busy}>
          Fechar
        </Button>
      )}
    </div>
  );
}
