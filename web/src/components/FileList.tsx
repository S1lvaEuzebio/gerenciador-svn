import type {
  IncomingChange,
  LocalChange,
  Project,
  ProjectRemoteStatus,
  ProjectStatus,
} from '@shared/types.ts';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  commitKey,
  displayPath,
  incomingLabel,
  isCommittable,
  isConflict,
  statusLabel,
  type StatusLabel,
} from '@/lib/status';
import { cn } from '@/lib/utils';
import type { FileSelection } from './DiffPanel';

export type FileTab = FileSelection['source'];

interface FileListProps {
  projects: Project[];
  statuses: Map<string, ProjectStatus>;
  remoteStatuses: Map<string, ProjectRemoteStatus>;
  /** Buscando o status (local ou remoto); a lista só some enquanto ainda não há dados. */
  localFetching: boolean;
  remoteFetching: boolean;
  error: Error | null;
  remoteError: Error | null;
  tab: FileTab;
  onTab: (tab: FileTab) => void;
  selection: FileSelection | null;
  onSelect: (selection: FileSelection) => void;
  /** Itens marcados para o commit (`commitKey`). */
  checked: Set<string>;
  onCheck: (keys: string[], checked: boolean) => void;
}

function splitPath(path: string): { name: string; dir: string } {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf('/');
  if (slash < 0) return { name: path, dir: '' };
  return { name: path.slice(slash + 1), dir: trimmed.slice(0, slash) };
}

function FileRow({
  path,
  status,
  ignored,
  leading,
  badge,
  selected,
  onClick,
}: {
  path: string;
  status: StatusLabel;
  ignored: boolean;
  /** Fica fora do botão da linha (ex.: caixa de seleção do commit). */
  leading?: ReactNode;
  badge?: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  const { name, dir } = splitPath(path);
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded pl-2',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        ignored && 'opacity-60',
      )}
    >
      {leading}
      <button
        type="button"
        onClick={onClick}
        title={`${status.label}: ${path}`}
        className="flex min-w-0 flex-1 items-baseline gap-2 py-0.5 pr-2 text-left"
      >
        <span className={cn('w-3 shrink-0 font-mono text-xs', status.className)}>
          {status.letter}
        </span>
        <span className="shrink-0 font-mono text-xs">{name}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]">
          {dir}
        </span>
        {badge}
      </button>
    </div>
  );
}

function SectionHeader({
  name,
  count,
  leading,
  detail,
  error,
}: {
  name: string;
  count: number;
  leading?: ReactNode;
  detail?: string;
  error?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2 px-2 py-1">
        {leading}
        <span className="truncate text-xs font-semibold">{name}</span>
        <span className="text-muted-foreground text-xs">{count}</span>
        {detail && (
          <span className="text-muted-foreground ml-auto font-mono text-[11px]">{detail}</span>
        )}
      </div>
      {error && (
        <p className="text-destructive flex items-start gap-1 px-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {error}
        </p>
      )}
    </>
  );
}

function TabButton({
  active,
  label,
  count,
  loading,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number | null;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-1 py-2 text-sm',
        active
          ? 'border-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground border-transparent',
      )}
    >
      {label}
      {count !== null && <span className="text-muted-foreground text-xs">{count}</span>}
      {loading && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
    </button>
  );
}

function LocalSections({
  projects,
  statuses,
  selection,
  onSelect,
  checked,
  onCheck,
}: Pick<
  FileListProps,
  'projects' | 'statuses' | 'selection' | 'onSelect' | 'checked' | 'onCheck'
>) {
  const [expandedIgnored, setExpandedIgnored] = useState<Set<string>>(new Set());

  const toggleIgnored = (projectId: string) => {
    setExpandedIgnored((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const sections = projects
    .map((project) => ({ project, status: statuses.get(project.id) }))
    .filter(({ status }) => status && (status.changes.length > 0 || status.error));
  if (sections.length === 0) {
    return <p className="text-muted-foreground px-3 py-2 text-sm">Nenhuma mudança local.</p>;
  }

  return sections.map(({ project, status }) => {
    const visible = status!.changes.filter((c) => !c.ignored);
    const ignored = status!.changes.filter((c) => c.ignored);
    const showIgnored = expandedIgnored.has(project.id);
    const committable = visible.filter(isCommittable).map((c) => commitKey(project.id, c.path));
    const checkedCount = committable.filter((key) => checked.has(key)).length;
    const row = (change: LocalChange) => (
      <FileRow
        key={change.path}
        path={displayPath(change)}
        status={statusLabel(change)}
        ignored={change.ignored}
        leading={
          change.ignored ? (
            <span className="size-4 shrink-0" />
          ) : (
            <Checkbox
              aria-label={`Marcar ${displayPath(change)} para o commit`}
              title={isConflict(change) ? 'Resolva o conflito antes de comitar' : undefined}
              disabled={!isCommittable(change)}
              checked={checked.has(commitKey(project.id, change.path))}
              onCheckedChange={(value) =>
                onCheck([commitKey(project.id, change.path)], value === true)
              }
            />
          )
        }
        selected={
          selection?.source === 'local' &&
          selection.projectId === project.id &&
          selection.path === change.path
        }
        onClick={() =>
          onSelect({
            source: 'local',
            projectId: project.id,
            projectName: project.name,
            path: change.path,
          })
        }
      />
    );

    return (
      <div key={project.id} className="px-1 pb-2">
        <SectionHeader
          name={project.name}
          count={visible.length}
          error={status!.error}
          leading={
            <Checkbox
              aria-label={`Marcar todos de ${project.name} para o commit`}
              disabled={committable.length === 0}
              checked={
                checkedCount === 0
                  ? false
                  : checkedCount === committable.length
                    ? true
                    : 'indeterminate'
              }
              onCheckedChange={() => onCheck(committable, checkedCount < committable.length)}
            />
          }
        />
        {visible.map(row)}
        {ignored.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => toggleIgnored(project.id)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-0.5 text-xs"
            >
              {showIgnored ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Ignorados ({ignored.length})
            </button>
            {showIgnored && ignored.map(row)}
          </>
        )}
      </div>
    );
  });
}

function IncomingBadges({ change }: { change: IncomingChange }) {
  return (
    <>
      {change.ignored && (
        <span
          className="text-muted-foreground shrink-0 text-[10px]"
          title="Casa com um padrão de ignorados, mas o update vai mexer nele"
        >
          ignorado
        </span>
      )}
      {change.localChange && (
        <span title="Também alterado localmente: o update pode dar conflito">
          <AlertTriangle className="text-warning-foreground size-3 shrink-0" />
        </span>
      )}
    </>
  );
}

function IncomingSections({
  projects,
  remoteStatuses,
  selection,
  onSelect,
}: Pick<FileListProps, 'projects' | 'remoteStatuses' | 'selection' | 'onSelect'>) {
  const sections = projects
    .map((project) => ({ project, status: remoteStatuses.get(project.id) }))
    .filter(({ status }) => status && (status.incoming.length > 0 || status.error));
  if (sections.length === 0) {
    return <p className="text-muted-foreground px-3 py-2 text-sm">Nada novo no servidor.</p>;
  }

  return sections.map(({ project, status }) => (
    <div key={project.id} className="px-1 pb-2">
      <SectionHeader
        name={project.name}
        count={status!.incoming.length}
        detail={
          status!.headRevision !== null
            ? `r${project.revision} → r${status!.headRevision}`
            : undefined
        }
        error={status!.error}
      />
      {status!.incoming.map((change) => (
        <FileRow
          key={change.path}
          path={displayPath(change)}
          status={incomingLabel(change)}
          ignored={change.ignored}
          badge={<IncomingBadges change={change} />}
          selected={
            selection?.source === 'incoming' &&
            selection.projectId === project.id &&
            selection.path === change.path
          }
          onClick={() =>
            onSelect({
              source: 'incoming',
              projectId: project.id,
              projectName: project.name,
              path: change.path,
            })
          }
        />
      ))}
    </div>
  ));
}

/** Coluna do meio: mudanças locais ou o que vai chegar do servidor, separadas por projeto. */
export function FileList({
  projects,
  statuses,
  remoteStatuses,
  localFetching,
  remoteFetching,
  error,
  remoteError,
  tab,
  onTab,
  selection,
  onSelect,
  checked,
  onCheck,
}: FileListProps) {
  const visibleIds = new Set(projects.map((p) => p.id));
  const localCount = [...statuses.values()]
    .filter((s) => visibleIds.has(s.projectId))
    .reduce((sum, s) => sum + s.changes.filter((c) => !c.ignored).length, 0);
  const remoteCount = [...remoteStatuses.values()]
    .filter((s) => visibleIds.has(s.projectId))
    .reduce((sum, s) => sum + s.incoming.length, 0);
  const currentError = tab === 'local' ? error : remoteError;
  const pending =
    tab === 'local'
      ? localFetching && statuses.size === 0
      : remoteFetching && remoteStatuses.size === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-4 border-b px-3">
        <TabButton
          active={tab === 'local'}
          label="Locais"
          count={localCount}
          loading={localFetching}
          onClick={() => onTab('local')}
        />
        <TabButton
          active={tab === 'incoming'}
          label="Servidor"
          count={remoteStatuses.size > 0 ? remoteCount : null}
          loading={remoteFetching}
          onClick={() => onTab('incoming')}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {currentError && (
          <p className="text-destructive px-3 py-2 text-sm">{currentError.message}</p>
        )}
        {!currentError &&
          !pending &&
          (tab === 'local' ? (
            <LocalSections
              projects={projects}
              statuses={statuses}
              selection={selection}
              onSelect={onSelect}
              checked={checked}
              onCheck={onCheck}
            />
          ) : (
            <IncomingSections
              projects={projects}
              remoteStatuses={remoteStatuses}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
      </div>
    </section>
  );
}
