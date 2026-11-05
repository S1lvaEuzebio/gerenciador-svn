import type { Project } from '@shared/types.ts';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useCleanupPreview, useOperationRun } from '@/lib/queries';
import { projectCount } from '@/lib/utils';
import { CommandBlock, LockNotice } from './ConfirmDialog';
import { OperationActions, OperationProgress } from './OperationProgress';
import { Placeholder } from './Placeholder';

interface CleanupDialogProps {
  /** Ex.: "vendas (5 projetos)". */
  scopeLabel: string;
  projects: Project[];
  locked: boolean;
  onUnlock: () => void;
  onClose: () => void;
}

/**
 * Cleanup dos projetos do escopo: tira travas que ficaram de uma operação interrompida. Mostra
 * os comandos antes de confirmar e a saída ao vivo depois.
 */
export function CleanupDialog({
  scopeLabel,
  projects,
  locked,
  onUnlock,
  onClose,
}: CleanupDialogProps) {
  const ids = projects.map((p) => p.id);
  const preview = useCleanupPreview(ids);
  const run = useOperationRun<void>(() => api.startCleanup(ids));

  return (
    <Dialog open onOpenChange={(next) => !next && !run.busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cleanup: {scopeLabel}</DialogTitle>
          <DialogDescription>
            {!run.started
              ? 'Tira as travas que ficam quando uma operação do svn é interrompida e termina o que ficou pela metade. Não mexe nas suas mudanças nem apaga arquivos.'
              : 'Saída do svn em tempo real.'}
          </DialogDescription>
        </DialogHeader>

        {run.started ? (
          <OperationProgress
            operation={run.operation}
            projects={projects}
            doneMessage="Cleanup concluído."
          />
        ) : preview.isPending ? (
          <Placeholder>
            <Loader2 className="size-5 animate-spin" />
          </Placeholder>
        ) : preview.isError ? (
          <p className="text-destructive text-sm">{preview.error.message}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">{projects.map((p) => p.name).join(', ')}</p>
            <CommandBlock commands={preview.data.commands} />
            {locked && <LockNotice kind="local" onUnlock={onUnlock} />}
            {run.startError && <p className="text-destructive text-sm">{run.startError.message}</p>}
          </div>
        )}

        <OperationActions
          run={run}
          onClose={onClose}
          confirmLabel={`Fazer cleanup (${projectCount(projects.length)})`}
          confirmDisabled={!preview.data || locked}
          onConfirm={() => run.start()}
        />
      </DialogContent>
    </Dialog>
  );
}
