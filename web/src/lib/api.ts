import type { Group, IgnoreConfig, ReadOnlyConfig } from '@shared/schema.ts';
import type {
  ConfigResponse,
  ConsoleEntry,
  DiffResponse,
  ProjectsResponse,
  StatusResponse,
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

export const api = {
  config: () => request<ConfigResponse>('/config'),
  saveRoots: (roots: string[]) => put<ConfigResponse>('/config/roots', { roots }),
  saveGroups: (groups: Group[]) => put<ConfigResponse>('/config/groups', { groups }),
  saveIgnore: (ignore: IgnoreConfig) => put<ConfigResponse>('/config/ignore', ignore),
  saveReadOnly: (readOnly: ReadOnlyConfig) => put<ConfigResponse>('/config/read-only', readOnly),
  projects: () => request<ProjectsResponse>('/projects'),
  status: () => request<StatusResponse>('/status'),
  diff: (project: string, path: string, force: boolean) =>
    request<DiffResponse>(
      `/diff?${new URLSearchParams({ project, path, force: force ? '1' : '0' })}`,
    ),
  console: () => request<ConsoleEntry[]>('/console'),
  clearConsole: () => request<void>('/console', { method: 'DELETE' }),
};
