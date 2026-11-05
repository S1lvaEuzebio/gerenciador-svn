import type { Group, IgnoreConfig, ReadOnlyConfig } from '@shared/schema.ts';
import type {
  CleanupPreview,
  CommandResult,
  CommitPreview,
  CommitRequest,
  ConfigResponse,
  ConflictDetails,
  ConsoleEntry,
  DiffCompare,
  DiffResponse,
  HistoryCompare,
  HistoryFilters,
  LogCursor,
  LogPage,
  MergeChoice,
  Operation,
  ProjectsResponse,
  RemoteStatusResponse,
  ResolveAccept,
  RevertPreview,
  RevertRequest,
  StatusResponse,
  UpdatePreview,
} from '@shared/types.ts';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : null;
    throw new Error(message ?? `erro HTTP ${response.status}`);
  }
  return data as T;
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export interface DiffRequest {
  projectId: string;
  path: string;
  compare: DiffCompare;
  /** Revisão do servidor, para os diffs que envolvem o servidor. */
  revision: number | null;
  force: boolean;
}

/** Histórico de um ou mais projetos (log unificado) ou de um arquivo de um projeto. */
export interface HistoryRequest extends HistoryFilters {
  projectIds: string[];
  /** Caminho relativo ao projeto, no histórico de arquivo. */
  file: string | null;
}

export interface HistoryDiffRequest {
  /** Projeto que dá acesso ao repositório e, em `current`, onde está o arquivo local. */
  projectId: string;
  /** Caminho a partir da raiz do repositório, como o log mostra. */
  path: string;
  revision: number;
  compare: HistoryCompare;
  /** Arquivo local (relativo ao projeto) comparado em `current`. */
  local: string | null;
  force: boolean;
}

export const api = {
  config: () => request<ConfigResponse>('/config'),
  saveRoots: (roots: string[]) => put<ConfigResponse>('/config/roots', { roots }),
  saveGroups: (groups: Group[]) => put<ConfigResponse>('/config/groups', { groups }),
  saveIgnore: (ignore: IgnoreConfig) => put<ConfigResponse>('/config/ignore', ignore),
  saveReadOnly: (readOnly: ReadOnlyConfig) => put<ConfigResponse>('/config/read-only', readOnly),
  saveCommitReferenceTemplate: (template: string) =>
    put<ConfigResponse>('/config/commit', { template }),
  saveRemotePolling: (remotePolling: boolean) =>
    put<ConfigResponse>('/config/polling', { remotePolling }),
  projects: () => request<ProjectsResponse>('/projects'),
  status: () => request<StatusResponse>('/status'),
  remoteStatus: () => request<RemoteStatusResponse>('/remote-status'),
  diff: ({ projectId, path, compare, revision, force }: DiffRequest) => {
    const params = new URLSearchParams({ project: projectId, path, compare });
    if (revision !== null) params.set('rev', String(revision));
    if (force) params.set('force', '1');
    return request<DiffResponse>(`/diff?${params}`);
  },
  history: ({ projectIds, file, author, text }: HistoryRequest, cursor: LogCursor | null) => {
    const params = new URLSearchParams();
    for (const id of projectIds) params.append('project', id);
    if (file !== null) params.set('file', file);
    if (author) params.set('author', author);
    if (text) params.set('text', text);
    if (cursor) {
      params.set('before', String(cursor.before));
      if (cursor.path !== null) params.set('beforePath', cursor.path);
    }
    return request<LogPage>(`/history?${params}`);
  },
  historyDiff: ({ projectId, path, revision, compare, local, force }: HistoryDiffRequest) => {
    const params = new URLSearchParams({
      project: projectId,
      path,
      rev: String(revision),
      compare,
    });
    if (local !== null) params.set('local', local);
    if (force) params.set('force', '1');
    return request<DiffResponse>(`/history/diff?${params}`);
  },
  updatePreview: (projects: string[]) => post<UpdatePreview>('/update/preview', { projects }),
  startUpdate: (targets: Array<{ projectId: string; revision: number }>) =>
    post<Operation>('/update', { targets }),
  operation: (id: number) => request<Operation>(`/operations/${id}`),
  commitPreview: (commit: CommitRequest) => post<CommitPreview>('/commit/preview', commit),
  startCommit: (commit: CommitRequest, fingerprint: string) =>
    post<Operation>('/commit', { ...commit, fingerprint }),
  revertPreview: (revert: RevertRequest) => post<RevertPreview>('/revert/preview', revert),
  startRevert: (revert: RevertRequest, fingerprint: string) =>
    post<Operation>('/revert', { ...revert, fingerprint }),
  cleanupPreview: (projects: string[]) => post<CleanupPreview>('/cleanup/preview', { projects }),
  startCleanup: (projects: string[]) => post<Operation>('/cleanup', { projects }),
  conflict: (project: string, path: string, force: boolean) =>
    request<ConflictDetails>(
      `/conflict?${new URLSearchParams({ project, path, force: force ? '1' : '0' })}`,
    ),
  resolve: (project: string, path: string, accept: ResolveAccept) =>
    post<CommandResult>('/conflict/resolve', { project, path, accept }),
  saveMerge: (project: string, path: string, fingerprint: string, choices: MergeChoice[]) =>
    post<CommandResult>('/conflict/merge', { project, path, fingerprint, choices }),
  console: () => request<ConsoleEntry[]>('/console'),
  clearConsole: () => request<void>('/console', { method: 'DELETE' }),
};
