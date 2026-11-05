import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import type { Group, IgnoreConfig, ReadOnlyConfig } from '@shared/schema.ts';
import type {
  CommitRequest,
  ConfigResponse,
  LogCursor,
  MergeChoice,
  Operation,
  ResolveAccept,
  RevertRequest,
} from '@shared/types.ts';
import { api, type DiffRequest, type HistoryDiffRequest, type HistoryRequest } from './api';

export const keys = {
  config: ['config'] as const,
  projects: ['projects'] as const,
  status: ['status'] as const,
  remoteStatus: ['remote-status'] as const,
  diff: (request: DiffRequest) => ['diff', request] as const,
  history: (request: HistoryRequest) => ['history', request] as const,
  historyDiff: (request: HistoryDiffRequest) => ['history-diff', request.compare, request] as const,
  conflict: (project: string, path: string, force: boolean) =>
    ['conflict', project, path, force] as const,
  updatePreview: (projects: string[]) => ['update-preview', projects] as const,
  commitPreview: (commit: CommitRequest) => ['commit-preview', commit] as const,
  revertPreview: (revert: RevertRequest) => ['revert-preview', revert] as const,
  cleanupPreview: (projects: string[]) => ['cleanup-preview', projects] as const,
  operation: (id: number) => ['operation', id] as const,
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

/** Intervalo da consulta periódica ao servidor. */
const REMOTE_POLL_MS = 10 * 60 * 1000;

/**
 * O que vai chegar do servidor. Consulta a rede (~2 s por working copy, em paralelo), então
 * roda ao abrir, pelo botão Recarregar e, com `polling`, a cada 10 minutos (também com a
 * janela em segundo plano, para o contador do título); não refaz ao focar a janela.
 */
export function useRemoteStatus(enabled: boolean, polling: boolean) {
  return useQuery({
    queryKey: keys.remoteStatus,
    queryFn: api.remoteStatus,
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: polling ? REMOTE_POLL_MS : false,
    refetchIntervalInBackground: true,
  });
}

export function useDiff(request: DiffRequest | null) {
  return useQuery({
    queryKey: keys.diff(request!),
    queryFn: () => api.diff(request!),
    enabled: request !== null,
  });
}

/** Histórico em páginas de 50. Consulta a rede: não refaz ao focar a janela, só pelo Recarregar. */
export function useHistory(request: HistoryRequest, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: keys.history(request),
    queryFn: ({ pageParam }) => api.history(request, pageParam),
    initialPageParam: null as LogCursor | null,
    getNextPageParam: (page) => page.next,
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** O que uma revisão mudou não muda depois; a comparação com o arquivo atual, sim. */
export function useHistoryDiff(request: HistoryDiffRequest | null) {
  return useQuery({
    queryKey: keys.historyDiff(request!),
    queryFn: () => api.historyDiff(request!),
    enabled: request !== null,
    staleTime: request?.compare === 'change' ? Infinity : 0,
    refetchOnWindowFocus: request?.compare === 'current',
  });
}

export function useConflict(project: string, path: string, force: boolean) {
  return useQuery({
    queryKey: keys.conflict(project, path, force),
    queryFn: () => api.conflict(project, path, force),
  });
}

/** Prévia sempre nova: refeita cada vez que a tela de update abre. */
export function useUpdatePreview(projects: string[]) {
  return useQuery({
    queryKey: keys.updatePreview(projects),
    queryFn: () => api.updatePreview(projects),
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** Prévia do commit: lista final, desatualizados e comandos. Refeita a cada abertura. */
export function useCommitPreview(commit: CommitRequest) {
  return useQuery({
    queryKey: keys.commitPreview(commit),
    queryFn: () => api.commitPreview(commit),
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** Prévia do revert: lista final e comandos. Refeita a cada abertura. */
export function useRevertPreview(revert: RevertRequest) {
  return useQuery({
    queryKey: keys.revertPreview(revert),
    queryFn: () => api.revertPreview(revert),
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useCleanupPreview(projects: string[]) {
  return useQuery({
    queryKey: keys.cleanupPreview(projects),
    queryFn: () => api.cleanupPreview(projects),
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** Acompanha uma operação de gravação até terminar. */
export function useOperation(id: number | null) {
  return useQuery({
    queryKey: keys.operation(id ?? 0),
    queryFn: () => api.operation(id!),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.done ? false : 500),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });
}

export function useConsole(open: boolean) {
  return useQuery({
    queryKey: keys.console,
    queryFn: api.console,
    enabled: open,
    refetchInterval: open ? 1500 : false,
    // continua atualizando com a janela sem foco (ex.: olhando o console enquanto usa o terminal)
    refetchIntervalInBackground: true,
  });
}

/**
 * O que muda quando a cópia local muda: status local, diffs, comparações do histórico com o
 * arquivo atual e detalhes de conflito.
 */
const LOCAL_KEYS = [keys.status, ['diff'], ['history-diff', 'current'], ['conflict']];

/** Rodescobre os projetos e só depois refaz os status, que usam a lista descoberta. */
export function useRefreshAll() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.refetchQueries({ queryKey: keys.projects });
    await Promise.all(
      [...LOCAL_KEYS, keys.remoteStatus, ['history']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  };
}

/**
 * Ciclo de uma operação de gravação nas janelas de update, commit, revert e cleanup: começa, acompanha a saída e,
 * ao terminar, recarrega tudo e avisa se todas as etapas deram certo.
 */
export function useOperationRun<T>(
  start: (args: T) => Promise<Operation>,
  onDone: (succeeded: boolean) => void,
) {
  const [operationId, setOperationId] = useState<number | null>(null);
  const operation = useOperation(operationId);
  const mutation = useMutation({ mutationFn: start, onSuccess: (op) => setOperationId(op.id) });
  const done = operation.data?.done ?? false;
  const succeeded = done && operation.data!.steps.every((s) => s.state === 'done');

  const refreshAll = useRefreshAll();
  const finish = useEffectEvent(() => {
    onDone(succeeded);
    void refreshAll();
  });
  useEffect(() => {
    if (done) finish();
  }, [done]);

  return {
    started: operationId !== null,
    operation: operation.data,
    start: mutation.mutate,
    starting: mutation.isPending,
    startError: mutation.error,
    /** A janela não fecha enquanto o svn roda: a saída e a recarga do status dependem dela. */
    busy: mutation.isPending || (operationId !== null && !done),
  };
}

/** Depois de resolver um conflito, que só mexe na cópia local. */
function useAfterLocalWrite() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(LOCAL_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function useResolve(project: string, path: string) {
  const after = useAfterLocalWrite();
  return useMutation({
    mutationFn: (accept: ResolveAccept) => api.resolve(project, path, accept),
    onSuccess: after,
  });
}

export function useSaveMerge(project: string, path: string) {
  const after = useAfterLocalWrite();
  return useMutation({
    mutationFn: ({ fingerprint, choices }: { fingerprint: string; choices: MergeChoice[] }) =>
      api.saveMerge(project, path, fingerprint, choices),
    onSuccess: after,
  });
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

export function useSaveRemotePolling() {
  return useConfigMutation((remotePolling: boolean) => api.saveRemotePolling(remotePolling));
}

export function useSaveCommitReferenceTemplate() {
  return useConfigMutation((template: string) => api.saveCommitReferenceTemplate(template));
}
