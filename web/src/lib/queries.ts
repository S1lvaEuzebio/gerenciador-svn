import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Group, IgnoreConfig, ReadOnlyConfig } from '@shared/schema.ts';
import type { ConfigResponse } from '@shared/types.ts';
import { api } from './api';

export const keys = {
  config: ['config'] as const,
  projects: ['projects'] as const,
  status: ['status'] as const,
  diff: (project: string, path: string, force: boolean) => ['diff', project, path, force] as const,
  console: ['console'] as const,
};

export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: api.config, staleTime: Infinity });
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: api.projects,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Status local: refeito sempre que a janela ganha foco (comportamento padrão do react-query). */
export function useStatus(enabled: boolean) {
  return useQuery({ queryKey: keys.status, queryFn: api.status, enabled });
}

export function useDiff(selection: { projectId: string; path: string } | null, force: boolean) {
  return useQuery({
    queryKey: keys.diff(selection?.projectId ?? '', selection?.path ?? '', force),
    queryFn: () => api.diff(selection!.projectId, selection!.path, force),
    enabled: selection !== null,
  });
}

export function useConsole(open: boolean) {
  return useQuery({
    queryKey: keys.console,
    queryFn: api.console,
    enabled: open,
    refetchInterval: open ? 1500 : false,
  });
}

/** Rodescobre os projetos e só depois refaz o status, que usa a lista descoberta. */
export function useRefreshAll() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.refetchQueries({ queryKey: keys.projects });
    await queryClient.invalidateQueries({ queryKey: keys.status });
    await queryClient.invalidateQueries({ queryKey: ['diff'] });
  };
}

/** Salva parte da configuração, guarda a resposta no cache e roda `after` antes de concluir. */
function useConfigMutation<T>(
  mutationFn: (value: T) => Promise<ConfigResponse>,
  after?: () => Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (data) => {
      queryClient.setQueryData(keys.config, data);
      await after?.();
    },
  });
}

export function useSaveRoots() {
  const refreshAll = useRefreshAll();
  return useConfigMutation((roots: string[]) => api.saveRoots(roots), refreshAll);
}

export function useSaveGroups() {
  return useConfigMutation((groups: Group[]) => api.saveGroups(groups));
}

export function useSaveIgnore() {
  const queryClient = useQueryClient();
  return useConfigMutation(
    (ignore: IgnoreConfig) => api.saveIgnore(ignore),
    () => queryClient.invalidateQueries({ queryKey: keys.status }),
  );
}

export function useSaveReadOnly() {
  return useConfigMutation((readOnly: ReadOnlyConfig) => api.saveReadOnly(readOnly));
}
