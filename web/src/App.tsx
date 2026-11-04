import { LOCK_LABELS } from '@shared/labels.ts';
import type { ReadOnlyConfig } from '@shared/schema.ts';
import type { ProjectStatus } from '@shared/types.ts';
import { useIsFetching } from '@tanstack/react-query';
import { FolderCog, Lock, RefreshCw, Settings, SquareTerminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConsolePanel } from '@/components/ConsolePanel';
import { DiffPanel, type FileSelection } from '@/components/DiffPanel';
import { FileList } from '@/components/FileList';
import { GroupsDialog } from '@/components/GroupsDialog';
import { Placeholder } from '@/components/Placeholder';
import { SettingsDialog, type SettingsTab } from '@/components/SettingsDialog';
import { ALL, Sidebar, UNGROUPED, type GroupFilter } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { keys, useConfig, useProjects, useRefreshAll, useStatus } from '@/lib/queries';
import { useStoredState } from '@/lib/use-stored-state';
import { cn } from '@/lib/utils';

const isNonEmpty = (value: string): value is string => value !== '';

export function App() {
  const config = useConfig();
  const projects = useProjects();
  const status = useStatus(projects.isSuccess);
  const refreshAll = useRefreshAll();
  const refreshing =
    useIsFetching({ queryKey: keys.status }) + useIsFetching({ queryKey: keys.projects }) > 0;

  const [groupFilter, setGroupFilter] = useStoredState<GroupFilter>(
    'group-filter',
    ALL,
    isNonEmpty,
  );
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selection, setSelection] = useState<FileSelection | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('roots');
  const [groupsOpen, setGroupsOpen] = useState(false);

  const allProjects = useMemo(() => projects.data?.projects ?? [], [projects.data]);
  const groups = useMemo(() => config.data?.config.groups ?? [], [config.data]);
  const statuses = useMemo(
    () => new Map<string, ProjectStatus>(status.data?.statuses.map((s) => [s.projectId, s]) ?? []),
    [status.data],
  );

  const activeFilter =
    groupFilter === ALL || groupFilter === UNGROUPED || groups.some((g) => g.id === groupFilter)
      ? groupFilter
      : ALL;
  const visibleProjects = useMemo(() => {
    if (activeFilter === ALL) return allProjects;
    if (activeFilter === UNGROUPED) {
      const grouped = new Set(groups.flatMap((g) => g.projects));
      return allProjects.filter((p) => !grouped.has(p.id));
    }
    const members = new Set(groups.find((g) => g.id === activeFilter)?.projects);
    return allProjects.filter((p) => members.has(p.id));
  }, [activeFilter, allProjects, groups]);
  const listedProjects =
    selectedProject && visibleProjects.some((p) => p.id === selectedProject)
      ? visibleProjects.filter((p) => p.id === selectedProject)
      : visibleProjects;

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const readOnly = config.data?.config.readOnly;
  const locks = readOnly
    ? (Object.keys(LOCK_LABELS) as (keyof ReadOnlyConfig)[])
        .filter((kind) => readOnly[kind])
        .map((kind) => LOCK_LABELS[kind])
    : [];

  if (config.isError) {
    return <Placeholder>Não foi possível falar com o servidor: {config.error.message}</Placeholder>;
  }
  if (!config.data) return <Placeholder>Carregando…</Placeholder>;

  const noRoots = config.data.config.roots.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h1 className="text-sm font-semibold">Gerenciador SVN</h1>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={noRoots}>
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
          Atualizar
        </Button>
        <Button
          variant={consoleOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={() => setConsoleOpen(!consoleOpen)}
          title="Console"
        >
          <SquareTerminal />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => openSettings('roots')}
          title="Configurações"
        >
          <Settings />
        </Button>
      </header>

      {locks.length > 0 && (
        <div className="bg-warning text-warning-foreground flex items-center gap-2 px-3 py-1 text-xs">
          <Lock className="size-3.5" />
          <span className="flex-1">Modo somente leitura. Travado: {locks.join(' e ')}.</span>
          <button type="button" className="underline" onClick={() => openSettings('read-only')}>
            Configurar
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1">
        {noRoots ? (
          <Placeholder>
            <FolderCog className="size-8 opacity-40" />
            <p>Nenhuma pasta raiz configurada.</p>
            <Button onClick={() => openSettings('roots')}>Configurar pastas</Button>
          </Placeholder>
        ) : (
          <div className="grid h-full grid-cols-[260px_minmax(280px,380px)_minmax(0,1fr)]">
            <Sidebar
              projects={allProjects}
              visibleProjects={visibleProjects}
              statuses={statuses}
              groups={groups}
              groupFilter={activeFilter}
              onGroupFilter={(filter) => {
                setGroupFilter(filter);
                setSelectedProject(null);
              }}
              selectedProject={selectedProject}
              onSelectProject={setSelectedProject}
              onManageGroups={() => setGroupsOpen(true)}
              errors={projects.data?.errors ?? []}
            />
            <FileList
              projects={listedProjects}
              statuses={statuses}
              loading={projects.isPending || status.isPending}
              error={projects.error ?? status.error}
              selection={selection}
              onSelect={setSelection}
            />
            <DiffPanel
              key={selection ? `${selection.projectId}\n${selection.path}` : 'none'}
              selection={selection}
            />
          </div>
        )}
      </main>

      {consoleOpen && <ConsolePanel onClose={() => setConsoleOpen(false)} />}

      <SettingsDialog
        key={settingsOpen ? 'open' : 'closed'}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        config={config.data.config}
        configPath={config.data.configPath}
        projects={allProjects}
      />
      <GroupsDialog
        key={groupsOpen ? 'groups-open' : 'groups-closed'}
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        groups={groups}
        projects={allProjects}
      />
    </div>
  );
}
