import type { DiffCompare, ProjectRemoteStatus } from '@shared/types.ts';
import { FileDiff } from 'lucide-react';
import { useState } from 'react';
import { useDiff } from '@/lib/queries';
import { useDiffDisplay } from '@/lib/use-diff-display';
import { DiffDisplayControls, DiffResult, HistoryButton, SegmentedControl } from './DiffView';
import { Placeholder } from './Placeholder';

export interface FileSelection {
  /** Lista de onde veio: mudanças locais ou o que vai chegar do servidor. */
  source: 'local' | 'incoming';
  projectId: string;
  projectName: string;
  path: string;
}

const COMPARE_LABELS: Record<DiffCompare, string> = {
  local: 'Minhas mudanças',
  incoming: 'O que vai chegar',
  'local-head': 'Local × servidor',
};

/** Nomes dos dois lados do diff, na ordem esquerda → direita. */
function sideNames(compare: DiffCompare, revision: number | null): [string, string] {
  const server = revision === null ? 'servidor' : `servidor r${revision}`;
  switch (compare) {
    case 'local':
      return ['base', 'local'];
    case 'incoming':
      return ['base', server];
    case 'local-head':
      return [server, 'local'];
  }
}

/**
 * Painel direito: diff do arquivo selecionado. Da lista local o padrão é "minhas mudanças";
 * da lista do servidor, "o que vai chegar". Os dois oferecem comparar a cópia local com o
 * servidor, na revisão do último status remoto do projeto (`remote`).
 */
export function DiffPanel({
  selection,
  remote,
  onHistory,
}: {
  selection: FileSelection | null;
  remote: ProjectRemoteStatus | undefined;
  /** Abre o histórico do arquivo; ausente quando o arquivo ainda não está no servidor. */
  onHistory?: () => void;
}) {
  const headRevision = remote?.headRevision ?? null;
  const incoming = remote?.incoming.find((c) => c.path === selection?.path);
  const [force, setForce] = useState(false);
  const display = useDiffDisplay();
  const options: DiffCompare[] =
    selection?.source === 'incoming' ? ['incoming', 'local-head'] : ['local', 'local-head'];
  const [compare, setCompare] = useState<DiffCompare>(options[0]!);
  const revision = compare === 'local' ? null : headRevision;
  const diff = useDiff(
    selection && { projectId: selection.projectId, path: selection.path, compare, revision, force },
  );
  const sides = sideNames(compare, headRevision);

  if (!selection) {
    return (
      <Placeholder>
        <FileDiff className="size-8 opacity-40" />
        Selecione um arquivo para ver o diff.
      </Placeholder>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm" title={selection.path}>
            {selection.path || '(pasta do projeto)'}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {selection.projectName} · {sides[0]} × {sides[1]}
          </div>
        </div>
        {onHistory && <HistoryButton onClick={onHistory} />}
        <SegmentedControl
          options={options.map((value) => ({
            value,
            label: COMPARE_LABELS[value],
            disabled: value !== 'local' && headRevision === null,
            title:
              value !== 'local' && headRevision === null
                ? 'Status do servidor ainda não carregado'
                : undefined,
          }))}
          value={compare}
          onChange={setCompare}
        />
        <DiffDisplayControls display={display} />
      </div>
      <div className="min-h-0 flex-1">
        <DiffResult
          query={diff}
          path={selection.path}
          sides={sides}
          serverItem={compare === 'local' ? null : (incoming?.item ?? null)}
          display={display}
          onForce={() => setForce(true)}
        />
      </div>
    </div>
  );
}
