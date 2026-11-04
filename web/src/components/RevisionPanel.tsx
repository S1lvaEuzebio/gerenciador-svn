import { changeSides } from '@shared/history.ts';
import type { ChangedPath, HistoryCompare, LogEntry, Project, ProjectFile } from '@shared/types.ts';
import { useState } from 'react';
import { useHistoryDiff } from '@/lib/queries';
import { changeActionLabel } from '@/lib/status';
import { cn, formatDate } from '@/lib/utils';
import { useDiffDisplay } from '@/lib/use-diff-display';
import { DiffDisplayControls, DiffResult, HistoryButton, SegmentedControl } from './DiffView';
import type { HistoryFile } from './HistoryList';
import { Placeholder } from './Placeholder';

/** Revisão aberta no painel direito, com o contexto em que foi escolhida. */
export interface RevisionSelection {
  entry: LogEntry;
  /** Projeto usado para chegar ao repositório quando o caminho não cai num projeto descoberto. */
  repoProjectId: string;
  /** Escolhida no histórico deste arquivo. */
  file: HistoryFile | null;
}

/** Arquivo da working copy que corresponde a um caminho da revisão, para comparar com o atual. */
function localFileOf(change: ChangedPath, selection: RevisionSelection): ProjectFile | null {
  // No histórico de arquivo, o caminho antigo (antes de renomear) é o arquivo atual.
  if (selection.file && change.path === selection.entry.file?.path) return selection.file;
  return change.project ?? null;
}

/** Nomes dos dois lados do diff do que a revisão mudou. */
function sideNames(change: ChangedPath, revision: number): [string, string] {
  const [left, right] = changeSides(change, revision);
  return [
    left === null ? '(não existia)' : `${change.copyFrom ? 'cópia de ' : ''}r${left.revision}`,
    right === null ? '(apagado)' : `r${right.revision}`,
  ];
}

function PathRow({
  change,
  projects,
  implied,
  selected,
  onClick,
}: {
  change: ChangedPath;
  projects: Map<string, string>;
  /** Não aparece na lista do svn: veio junto com uma pasta copiada ou renomeada. */
  implied: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const action = changeActionLabel(change.action);
  const title = [
    action.label,
    change.propMods && 'propriedades alteradas',
    change.copyFrom && `copiado de ${change.copyFrom.path} (r${change.copyFrom.revision})`,
    implied && 'veio junto com a pasta copiada nesta revisão',
  ]
    .filter(Boolean)
    .join('; ');
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${title}: ${change.path}`}
      className={cn(
        'flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
      )}
    >
      <span className={cn('w-3 shrink-0 font-mono text-xs', action.className)}>
        {action.letter}
      </span>
      {change.project ? (
        <>
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {projects.get(change.project.projectId)}
          </span>
          <span className="min-w-0 truncate font-mono text-xs">
            {change.project.path || '(pasta do projeto)'}
            {change.kind === 'dir' && change.project.path !== '' && '/'}
          </span>
        </>
      ) : (
        <span className="min-w-0 truncate font-mono text-xs">{change.path}</span>
      )}
      {change.copyFrom && (
        <span className="text-muted-foreground min-w-0 shrink truncate font-mono text-[11px]">
          ← {change.copyFrom.path}
        </span>
      )}
      {(change.propMods || implied) && (
        <span className="text-muted-foreground ml-auto shrink-0 text-[11px] italic">
          {implied ? 'com a pasta' : 'propriedades'}
        </span>
      )}
    </button>
  );
}

/** Diff de um caminho da revisão: o que ela mudou, ou a versão dela contra o arquivo atual. */
function ChangeDiff({
  change,
  selection,
  onFileHistory,
}: {
  change: ChangedPath;
  selection: RevisionSelection;
  onFileHistory: (file: ProjectFile) => void;
}) {
  const { revision } = selection.entry;
  const local = localFileOf(change, selection);
  const canCompareCurrent = local !== null && change.kind !== 'dir' && change.action !== 'D';
  const [compare, setCompare] = useState<HistoryCompare>('change');
  const [force, setForce] = useState(false);
  const display = useDiffDisplay();
  // Pasta criada ou apagada não tem o que comparar além do aviso.
  const nothingToFetch = change.kind === 'dir' && (change.action === 'A' || change.action === 'D');
  const diff = useHistoryDiff(
    nothingToFetch
      ? null
      : {
          projectId: local?.projectId ?? selection.repoProjectId,
          path: change.path,
          revision,
          compare,
          local: compare === 'current' ? local!.path : null,
          force,
        },
  );
  const sides: [string, string] =
    compare === 'current' ? [`r${revision}`, 'local'] : sideNames(change, revision);
  const isOwnHistory =
    selection.file !== null &&
    local?.projectId === selection.file.projectId &&
    local.path === selection.file.path;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <div className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          {sides[0]} × {sides[1]}
        </div>
        {local && change.kind !== 'dir' && !isOwnHistory && (
          <HistoryButton onClick={() => onFileHistory(local)} />
        )}
        <SegmentedControl
          options={[
            { value: 'change', label: `Mudança na r${revision}` },
            {
              value: 'current',
              label: `r${revision} × atual`,
              disabled: !canCompareCurrent,
              title: canCompareCurrent
                ? 'Compara esta versão com o arquivo atual da working copy'
                : 'Sem arquivo correspondente numa working copy',
            },
          ]}
          value={compare}
          onChange={setCompare}
        />
        <DiffDisplayControls display={display} />
      </div>
      <div className="min-h-0 flex-1">
        {nothingToFetch ? (
          <Placeholder>
            {change.action === 'D'
              ? 'Pasta apagada nesta revisão, com tudo o que tinha dentro.'
              : change.copyFrom
                ? `Pasta copiada de ${change.copyFrom.path} (r${change.copyFrom.revision}).`
                : 'Pasta criada nesta revisão.'}
          </Placeholder>
        ) : (
          <DiffResult
            query={diff}
            path={change.path}
            sides={sides}
            display={display}
            onForce={() => setForce(true)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Painel direito, aba Histórico: autor, data, mensagem e caminhos da revisão; o caminho escolhido
 * mostra o diff. No histórico de arquivo, o arquivo já vem escolhido.
 */
export function RevisionPanel({
  selection,
  projects,
  onFileHistory,
}: {
  selection: RevisionSelection;
  projects: Project[];
  onFileHistory: (file: HistoryFile) => void;
}) {
  const { entry } = selection;
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const fileChange = selection.file ? entry.file : undefined;
  const impliedFile =
    fileChange && !entry.paths.some((p) => p.path === fileChange.path) ? fileChange : undefined;
  const paths = impliedFile ? [impliedFile, ...entry.paths] : entry.paths;
  const [selectedPath, setSelectedPath] = useState<string | null>(
    fileChange?.path ?? (paths.length === 1 ? paths[0]!.path : null),
  );
  const selected = paths.find((p) => p.path === selectedPath);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-1 border-b px-3 py-2">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-mono font-semibold">r{entry.revision}</span>
          <span>{entry.author}</span>
          <span className="text-muted-foreground text-xs">{formatDate(entry.date)}</span>
        </div>
        <pre className="max-h-32 overflow-y-auto font-sans text-sm whitespace-pre-wrap">
          {entry.message || '(sem mensagem)'}
        </pre>
      </div>
      <div className="max-h-[30%] shrink-0 overflow-y-auto border-b p-1">
        <div className="text-muted-foreground px-2 pb-0.5 text-xs font-medium uppercase">
          Caminhos ({paths.length})
        </div>
        {paths.map((change) => (
          <PathRow
            key={change.path}
            change={change}
            projects={names}
            implied={change === impliedFile}
            selected={change.path === selectedPath}
            onClick={() => setSelectedPath(change.path)}
          />
        ))}
      </div>
      {selected ? (
        <ChangeDiff
          key={selected.path}
          change={selected}
          selection={selection}
          onFileHistory={(local) =>
            onFileHistory({
              projectId: local.projectId,
              projectName: names.get(local.projectId) ?? '',
              path: local.path,
            })
          }
        />
      ) : (
        <Placeholder>Escolha um caminho para ver o diff.</Placeholder>
      )}
    </div>
  );
}
