import type { Group } from '@shared/schema.ts';
import type { Project, ProjectStatus, RootError } from '@shared/types.ts';
import { AlertTriangle, ArrowUp, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isConflict } from '@/lib/status';
import { cn } from '@/lib/utils';

/** `all`, `ungrouped` ou o id de um grupo. */
export type GroupFilter = string;

export const ALL = 'all';
export const UNGROUPED = 'ungrouped';

interface SidebarProps {
  projects: Project[];
  visibleProjects: Project[];
  statuses: Map<string, ProjectStatus>;
  groups: Group[];
  groupFilter: GroupFilter;
  onGroupFilter: (filter: GroupFilter) => void;
  selectedProject: string | null;
  onSelectProject: (id: string | null) => void;
  onManageGroups: () => void;
  errors: RootError[];
}

function counts(status: ProjectStatus | undefined) {
  const changes = status?.changes.filter((c) => !c.ignored) ?? [];
  return { local: changes.length, conflicts: changes.filter(isConflict).length };
}

function GroupButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm',
        active ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/50',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="text-muted-foreground text-xs">{count}</span>
    </button>
  );
}

export function Sidebar({
  projects,
  visibleProjects,
  statuses,
  groups,
  groupFilter,
  onGroupFilter,
  selectedProject,
  onSelectProject,
  onManageGroups,
  errors,
}: SidebarProps) {
  const grouped = new Set(groups.flatMap((g) => g.projects));
  const known = new Set(projects.map((p) => p.id));
  const ungroupedCount = projects.filter((p) => !grouped.has(p.id)).length;

  return (
    <aside className="flex h-full min-h-0 flex-col border-r">
      <div className="border-b p-2">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-muted-foreground text-xs font-medium uppercase">Grupos</span>
          <Button variant="ghost" size="icon-sm" onClick={onManageGroups} title="Gerenciar grupos">
            <Settings2 />
          </Button>
        </div>
        <GroupButton
          active={groupFilter === ALL}
          label="Todos"
          count={projects.length}
          onClick={() => onGroupFilter(ALL)}
        />
        {groups.map((group) => (
          <GroupButton
            key={group.id}
            active={groupFilter === group.id}
            label={group.name}
            count={group.projects.filter((id) => known.has(id)).length}
            onClick={() => onGroupFilter(group.id)}
          />
        ))}
        {groups.length > 0 && (
          <GroupButton
            active={groupFilter === UNGROUPED}
            label="Sem grupo"
            count={ungroupedCount}
            onClick={() => onGroupFilter(UNGROUPED)}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="text-muted-foreground px-2 pb-1 text-xs font-medium uppercase">
          Projetos
        </div>
        {visibleProjects.length === 0 && (
          <p className="text-muted-foreground px-2 py-1 text-sm">Nenhum projeto aqui.</p>
        )}
        {visibleProjects.map((project) => {
          const status = statuses.get(project.id);
          const { local, conflicts } = counts(status);
          const active = selectedProject === project.id;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelectProject(active ? null : project.id)}
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left',
                active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{project.name}</div>
                <div className="text-muted-foreground truncate font-mono text-[11px]">
                  {project.relativeUrl}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs">
                {status?.error && (
                  <span title={status.error}>
                    <AlertTriangle className="text-destructive size-3.5" />
                  </span>
                )}
                {conflicts > 0 && (
                  <span
                    className="text-destructive flex items-center gap-0.5 font-medium"
                    title={`${conflicts} em conflito`}
                  >
                    <AlertTriangle className="size-3" />
                    {conflicts}
                  </span>
                )}
                {local > 0 && (
                  <span
                    className="text-muted-foreground flex items-center gap-0.5"
                    title={`${local} mudanças locais`}
                  >
                    <ArrowUp className="size-3" />
                    {local}
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {errors.length > 0 && (
          <div className="mt-3 space-y-1 px-2">
            {errors.map((error) => (
              <p key={error.root} className="text-destructive text-xs" title={error.message}>
                {error.root}: {error.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
