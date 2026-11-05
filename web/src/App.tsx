import { NO_FILTERS } from '@shared/history.ts';
import { LOCK_LABELS } from '@shared/labels.ts';
import type { ReadOnlyConfig } from '@shared/schema.ts';
import type {
  CommitRequest,
  HistoryFilters,
  RevertRequest,
  Project,
  ProjectRemoteStatus,
  ProjectStatus,
} from '@shared/types.ts';
import { useIsFetching } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  BrushCleaning,
  FolderCog,
  History,
  Lock,
  RefreshCw,
  Settings,
  SquareTerminal,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { CleanupDialog } from '@/components/CleanupDialog';
import { CommitDialog } from '@/components/CommitDialog';
import { CommitPanel } from '@/components/CommitPanel';
import { ConflictPanel } from '@/components/ConflictPanel';
import { ConsolePanel } from '@/components/ConsolePanel';
import { DiffPanel, type FileSelection } from '@/components/DiffPanel';
import { FileList, type FileTab } from '@/components/FileList';
import { GroupsDialog } from '@/components/GroupsDialog';
import { HistoryList, type HistoryFile } from '@/components/HistoryList';
import { Placeholder } from '@/components/Placeholder';
import { RevertDialog } from '@/components/RevertDialog';
import { RevisionPanel, type RevisionSelection } from '@/components/RevisionPanel';
import { SettingsDialog, type SettingsTab } from '@/components/SettingsDialog';
import { ALL, Sidebar, UNGROUPED, type GroupFilter } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { UpdateDialog } from '@/components/UpdateDialog';
import {
  keys,
  useConfig,
  useProjects,
  useRefreshAll,
  useRemoteStatus,
  useStatus,
} from '@/lib/queries';
import { useCommitMessage } from '@/lib/commit-message';
import { useCommitSelection } from '@/lib/commit-selection';
import { isConflict, isRevertable } from '@/lib/status';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useNewsBadge } from '@/lib/use-news-badge';
import { useStoredState } from '@/lib/use-stored-state';
import { cn, projectCount } from '@/lib/utils';

const isNonEmpty = (value: string): value is string => value !== '';
const isFileTab = (value: string): value is FileTab =>
  value === 'local' || value === 'incoming' || value === 'history';

export function App() {
  const config = useConfig();
  const projects = useProjects();
  const status = useStatus(projects.isSuccess);
  const remote = useRemoteStatus(projects.isSuccess, config.data?.config.remotePolling ?? false);
  const refreshAll = useRefreshAll();
  const refreshing =
    useIsFetching({ queryKey: keys.status }) +
      useIsFetching({ queryKey: keys.remoteStatus }) +
      useIsFetching({ queryKey: keys.projects }) >
    0;

  const [groupFilter, setGroupFilter] = useStoredState<GroupFilter>(
    'group-filter',
    ALL,
    isNonEmpty,
  );
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selection, setSelection] = useState<FileSelection | null>(null);
  const [fileTab, setFileTab] = useStoredState<FileTab>('file-tab', 'local', isFileTab);
  const [historyFile, setHistoryFile] = useState<HistoryFile | null>(null);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(NO_FILTERS);
  /** Filtro aplicado depois de uma pausa na digitação: cada busca consulta o servidor. */
  const appliedFilters = useDebouncedValue(historyFilters, 400);
  const [revision, setRevision] = useState<RevisionSelection | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  /** Pedido do revert em confirmação, copiado no clique como o do commit. */
  const [revertRequest, setRevertRequest] = useState<RevertRequest | null>(null);
  /** Update pedido pelo commit (itens desatualizados), no lugar do escopo da tela. */
  const [updateTargets, setUpdateTargets] = useState<Project[] | null>(null);
  /** Pedido do commit em confirmação, copiado no clique para a prévia não mudar com a lista. */
  const [commitRequest, setCommitRequest] = useState<CommitRequest | null>(null);
  const draft = useCommitMessage(config.data?.config.commitReferenceTemplate ?? null);
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
  const remoteStatuses = useMemo(
    () =>
      new Map<string, ProjectRemoteStatus>(
        remote.data?.statuses.map((s) => [s.projectId, s]) ?? [],
      ),
    [remote.data],
  );
  const commitSelection = useCommitSelection(allProjects, statuses);

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

  // Update vale para o projeto selecionado ou, sem seleção, para todos os projetos visíveis.
  const scopeProject = listedProjects.length === 1 && selectedProject ? listedProjects[0] : null;
  const scopeLabel = scopeProject
    ? scopeProject.name
    : activeFilter === ALL
      ? `todos (${projectCount(visibleProjects.length)})`
      : activeFilter === UNGROUPED
        ? `sem grupo (${projectCount(visibleProjects.length)})`
        : `${groups.find((g) => g.id === activeFilter)?.name} (${projectCount(visibleProjects.length)})`;
  const incomingInScope = listedProjects.reduce(
    (sum, p) => sum + (remoteStatuses.get(p.id)?.incoming.length ?? 0),
    0,
  );

  const selectedChange =
    selection?.source === 'local'
      ? statuses.get(selection.projectId)?.changes.find((c) => c.path === selection.path)
      : undefined;
  // Arquivo novo (ainda não comitado) não tem histórico no servidor.
  const hasHistory =
    selection !== null &&
    !(selectedChange && (selectedChange.item === 'unversioned' || selectedChange.item === 'added'));
  const openFileHistory = (file: HistoryFile) => {
    setHistoryFile(file);
    setRevision(null);
    setFileTab('history');
  };
  const historyProjects = historyFile
    ? allProjects.filter((p) => p.id === historyFile.projectId)
    : listedProjects;

  // Revert vale para mudança local de item versionado (inclusive ignorado).
  const canRevert = selectedChange !== undefined && isRevertable(selectedChange);
  const incomingTotal = [...remoteStatuses.values()].reduce((sum, s) => sum + s.incoming.length, 0);
  useNewsBadge(incomingTotal);

  const unlockLocal = () => {
    setUpdateOpen(false);
    setCleanupOpen(false);
    setRevertRequest(null);
    openSettings('read-only');
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
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={noRoots}
          title="Recarrega projetos, mudanças locais e o que há de novo no servidor"
        >
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
          Recarregar
        </Button>
        <Button
          size="sm"
          onClick={() => setUpdateOpen(true)}
          disabled={noRoots || listedProjects.length === 0}
          title={`Update: ${scopeLabel}`}
        >
          <ArrowDownToLine />
          Update
          {incomingInScope > 0 && (
            <span className="bg-primary-foreground/20 rounded px-1 text-xs">{incomingInScope}</span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCleanupOpen(true)}
          disabled={noRoots || listedProjects.length === 0}
          title={`Cleanup: ${scopeLabel}. Tira travas que ficam de uma operação interrompida.`}
        >
          <BrushCleaning />
          Cleanup
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
              remoteStatuses={remoteStatuses}
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
            <div className="flex min-h-0 flex-col border-r">
              <FileList
                projects={listedProjects}
                statuses={statuses}
                remoteStatuses={remoteStatuses}
                localFetching={projects.isPending || status.isFetching}
                remoteFetching={projects.isPending || remote.isFetching}
                error={projects.error ?? status.error}
                remoteError={projects.error ?? remote.error}
                tab={fileTab}
                onTab={setFileTab}
                selection={selection}
                onSelect={setSelection}
                checked={commitSelection.checked}
                onCheck={commitSelection.setMany}
                history={
                  <HistoryList
                    request={{
                      projectIds: historyProjects.map((p) => p.id),
                      file: historyFile?.path ?? null,
                      ...appliedFilters,
                    }}
                    scopeLabel={scopeLabel}
                    file={historyFile}
                    onCloseFile={() => {
                      setHistoryFile(null);
                      setRevision(null);
                    }}
                    filters={historyFilters}
                    onFilters={setHistoryFilters}
                    projects={allProjects}
                    selected={revision?.entry.revision ?? null}
                    onSelect={(entry) =>
                      setRevision({
                        entry,
                        repoProjectId: historyProjects[0]!.id,
                        file: historyFile,
                      })
                    }
                  />
                }
              />
              <CommitPanel
                items={commitSelection.items}
                template={config.data.config.commitReferenceTemplate}
                draft={draft}
                onUncheck={(keys) => commitSelection.setMany(keys, false)}
                onCommit={() =>
                  setCommitRequest({
                    items: commitSelection.items.map(({ project, change }) => ({
                      projectId: project.id,
                      path: change.path,
                    })),
                    message: draft.message,
                  })
                }
                onRevert={() =>
                  setRevertRequest({
                    items: commitSelection.items
                      .filter(({ change }) => isRevertable(change))
                      .map(({ project, change }) => ({ projectId: project.id, path: change.path })),
                  })
                }
              />
            </div>
            {fileTab === 'history' ? (
              revision ? (
                <RevisionPanel
                  key={`${revision.entry.revision}\n${revision.file?.projectId}\n${revision.file?.path}`}
                  selection={revision}
                  projects={allProjects}
                  onFileHistory={openFileHistory}
                />
              ) : (
                <Placeholder>
                  <History className="size-8 opacity-40" />
                  Selecione uma revisão para ver os detalhes.
                </Placeholder>
              )
            ) : selection && selectedChange && isConflict(selectedChange) ? (
              <ConflictPanel
                key={`${selection.projectId}\n${selection.path}`}
                selection={selection}
                locked={readOnly?.local ?? true}
                onUnlock={unlockLocal}
              />
            ) : (
              <DiffPanel
                key={
                  selection
                    ? `${selection.source}\n${selection.projectId}\n${selection.path}`
                    : 'none'
                }
                selection={selection}
                remote={selection ? remoteStatuses.get(selection.projectId) : undefined}
                onHistory={
                  hasHistory
                    ? () =>
                        openFileHistory({
                          projectId: selection.projectId,
                          projectName: selection.projectName,
                          path: selection.path,
                        })
                    : undefined
                }
                onRevert={
                  canRevert && selection
                    ? () =>
                        setRevertRequest({
                          items: [{ projectId: selection.projectId, path: selection.path }],
                        })
                    : undefined
                }
              />
            )}
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
      {updateOpen && (
        <UpdateDialog
          open
          onOpenChange={(open) => {
            setUpdateOpen(open);
            if (!open) setUpdateTargets(null);
          }}
          scopeLabel={
            updateTargets
              ? `desatualizados do commit (${projectCount(updateTargets.length)})`
              : scopeLabel
          }
          projects={updateTargets ?? listedProjects}
          locked={readOnly?.local ?? true}
          onUnlock={unlockLocal}
        />
      )}
      {cleanupOpen && (
        <CleanupDialog
          scopeLabel={scopeLabel}
          projects={listedProjects}
          locked={readOnly?.local ?? true}
          onUnlock={unlockLocal}
          onClose={() => setCleanupOpen(false)}
        />
      )}
      {revertRequest && (
        <RevertDialog
          request={revertRequest}
          projects={allProjects}
          locked={readOnly?.local ?? true}
          onUnlock={unlockLocal}
          onClose={() => setRevertRequest(null)}
        />
      )}
      {commitRequest && (
        <CommitDialog
          request={commitRequest}
          projects={allProjects}
          locked={readOnly?.commit ?? true}
          onUnlock={() => {
            setCommitRequest(null);
            openSettings('read-only');
          }}
          onClose={() => setCommitRequest(null)}
          onUpdate={(ids) => {
            setCommitRequest(null);
            setUpdateTargets(allProjects.filter((p) => ids.includes(p.id)));
            setUpdateOpen(true);
          }}
          onCommitted={(message) => {
            draft.remember(message);
            commitSelection.clear();
          }}
        />
      )}
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
