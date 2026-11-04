import type { LocalChange, Project, ProjectStatus } from '@shared/types.ts';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { displayPath, statusLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { FileSelection } from './DiffPanel';

interface FileListProps {
  projects: Project[];
  statuses: Map<string, ProjectStatus>;
  loading: boolean;
  error: Error | null;
  selection: FileSelection | null;
  onSelect: (selection: FileSelection) => void;
}

function splitPath(change: LocalChange): { name: string; dir: string } {
  const path = displayPath(change);
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf('/');
  if (slash < 0) return { name: path, dir: '' };
  return { name: path.slice(slash + 1), dir: trimmed.slice(0, slash) };
}

function ChangeRow({
  change,
  selected,
  onClick,
}: {
  change: LocalChange;
  selected: boolean;
  onClick: () => void;
}) {
  const status = statusLabel(change);
  const { name, dir } = splitPath(change);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${status.label}: ${displayPath(change)}`}
      className={cn(
        'flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        change.ignored && 'opacity-60',
      )}
    >
      <span className={cn('w-3 shrink-0 font-mono text-xs', status.className)}>
        {status.letter}
      </span>
      <span className="shrink-0 font-mono text-xs">{name}</span>
      <span className="text-muted-foreground min-w-0 truncate font-mono text-[11px]">{dir}</span>
    </button>
  );
}

/** Coluna do meio: mudanças locais dos projetos visíveis, separadas por projeto. */
export function FileList({
  projects,
  statuses,
  loading,
  error,
  selection,
  onSelect,
}: FileListProps) {
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
  const total = sections.reduce(
    (sum, { status }) => sum + (status?.changes.filter((c) => !c.ignored).length ?? 0),
    0,
  );

  return (
    <section className="flex h-full min-h-0 flex-col border-r">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">Locais</span>
        <span className="text-muted-foreground text-xs">{total}</span>
        {loading && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {error && <p className="text-destructive px-3 py-2 text-sm">{error.message}</p>}
        {!error && sections.length === 0 && !loading && (
          <p className="text-muted-foreground px-3 py-2 text-sm">Nenhuma mudança local.</p>
        )}
        {sections.map(({ project, status }) => {
          const visible = status!.changes.filter((c) => !c.ignored);
          const ignored = status!.changes.filter((c) => c.ignored);
          const showIgnored = expandedIgnored.has(project.id);
          const isSelected = (change: LocalChange) =>
            selection?.projectId === project.id && selection.path === change.path;
          const select = (change: LocalChange) =>
            onSelect({ projectId: project.id, projectName: project.name, path: change.path });

          return (
            <div key={project.id} className="px-1 pb-2">
              <div className="flex items-center gap-2 px-2 py-1">
                <span className="truncate text-xs font-semibold">{project.name}</span>
                <span className="text-muted-foreground text-xs">{visible.length}</span>
              </div>
              {status!.error && (
                <p className="text-destructive flex items-start gap-1 px-2 text-xs">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  {status!.error}
                </p>
              )}
              {visible.map((change) => (
                <ChangeRow
                  key={change.path}
                  change={change}
                  selected={isSelected(change)}
                  onClick={() => select(change)}
                />
              ))}
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
                  {showIgnored &&
                    ignored.map((change) => (
                      <ChangeRow
                        key={change.path}
                        change={change}
                        selected={isSelected(change)}
                        onClick={() => select(change)}
                      />
                    ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
