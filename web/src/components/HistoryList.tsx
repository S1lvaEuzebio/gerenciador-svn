import { hasFilters, NO_FILTERS } from '@shared/history.ts';
import type { HistoryFilters, LogEntry, Project, ProjectFile } from '@shared/types.ts';
import { FileClock, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { HistoryRequest } from '@/lib/api';
import { useHistory } from '@/lib/queries';
import { cn, firstLine, formatDate } from '@/lib/utils';

/** Arquivo cujo histórico está aberto, no caminho atual da working copy. */
export interface HistoryFile extends ProjectFile {
  projectName: string;
}

interface HistoryListProps {
  request: HistoryRequest;
  /** Ex.: "vendas (5 projetos)"; no histórico de arquivo, o arquivo aparece no lugar. */
  scopeLabel: string;
  file: HistoryFile | null;
  onCloseFile: () => void;
  filters: HistoryFilters;
  onFilters: (filters: HistoryFilters) => void;
  projects: Project[];
  selected: number | null;
  onSelect: (entry: LogEntry) => void;
}

/** Projetos que a revisão mexeu, para o log unificado de vários projetos. */
function touchedProjects(entry: LogEntry, names: Map<string, string>): string[] {
  const ids = new Set(entry.paths.flatMap((p) => (p.project ? [p.project.projectId] : [])));
  return [...ids].map((id) => names.get(id) ?? id);
}

function EntryRow({
  entry,
  projectNames,
  selected,
  onClick,
}: {
  entry: LogEntry;
  /** Só no log de vários projetos. */
  projectNames: string[] | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={entry.message}
      className={cn(
        'w-full rounded px-2 py-1 text-left',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
      )}
    >
      <div className="flex items-baseline gap-2 text-xs">
        <span className="shrink-0 font-mono font-medium">r{entry.revision}</span>
        <span className="text-muted-foreground min-w-0 truncate">{entry.author}</span>
        <span className="text-muted-foreground ml-auto shrink-0">{formatDate(entry.date)}</span>
      </div>
      <div className="truncate text-sm">{firstLine(entry.message) || '(sem mensagem)'}</div>
      {projectNames && projectNames.length > 0 && (
        <div className="text-muted-foreground truncate text-[11px]">{projectNames.join(', ')}</div>
      )}
    </button>
  );
}

/**
 * Coluna do meio, aba Histórico: revisões do filtro atual (projeto, grupo ou todos, num log só)
 * ou de um arquivo, 50 por vez, com filtro por autor e texto da mensagem.
 */
export function HistoryList({
  request,
  scopeLabel,
  file,
  onCloseFile,
  filters,
  onFilters,
  projects,
  selected,
  onSelect,
}: HistoryListProps) {
  const history = useHistory(request, request.projectIds.length > 0);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const unified = file === null && request.projectIds.length > 1;
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
  const scannedTo = history.data?.pages.at(-1)?.scannedTo ?? null;
  const filtering = hasFilters(request);
  // Com filtro, a busca para depois de um tanto de revisões; a tela diz até onde foi.
  const searchedTo = filtering && history.hasNextPage ? scannedTo : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-1.5 border-b px-2 py-2">
        {file ? (
          <div className="flex items-center gap-1.5 px-1 text-xs">
            <FileClock className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
              {file.path}
            </span>
            <span className="text-muted-foreground shrink-0">{file.projectName}</span>
            <button
              type="button"
              onClick={onCloseFile}
              className="text-muted-foreground hover:text-foreground"
              title="Voltar ao histórico dos projetos"
              aria-label="Fechar histórico do arquivo"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="text-muted-foreground truncate px-1 text-xs">{scopeLabel}</div>
        )}
        <div className="flex gap-1.5">
          <Input
            value={filters.author}
            onChange={(e) => onFilters({ ...filters, author: e.target.value })}
            placeholder="Autor"
            aria-label="Filtrar por autor"
            className="h-7 w-28 text-xs"
          />
          <Input
            value={filters.text}
            onChange={(e) => onFilters({ ...filters, text: e.target.value })}
            placeholder="Texto da mensagem"
            aria-label="Filtrar pelo texto da mensagem"
            className="h-7 min-w-0 flex-1 text-xs"
          />
          {hasFilters(filters) && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={() => onFilters(NO_FILTERS)}
              title="Limpar filtros"
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {request.projectIds.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1 text-sm">Nenhum projeto aqui.</p>
        ) : history.isPending ? (
          <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {filtering ? 'Procurando…' : 'Carregando…'}
          </div>
        ) : history.isLoadingError ? (
          <p className="text-destructive px-2 py-1 text-sm">{history.error.message}</p>
        ) : (
          <>
            {entries.map((entry) => (
              <EntryRow
                key={entry.revision}
                entry={entry}
                projectNames={unified ? touchedProjects(entry, names) : null}
                selected={selected === entry.revision}
                onClick={() => onSelect(entry)}
              />
            ))}
            {entries.length === 0 && (
              <p className="text-muted-foreground px-2 py-1 text-sm">
                {filtering ? 'Nenhuma revisão com esse filtro' : 'Nenhuma revisão'}
                {searchedTo !== null ? ` até a r${searchedTo}.` : '.'}
              </p>
            )}
            <div className="space-y-1 px-2 py-2">
              {searchedTo !== null && entries.length > 0 && (
                <p className="text-muted-foreground text-xs">Procurado até a r{searchedTo}.</p>
              )}
              {history.hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => void history.fetchNextPage()}
                  disabled={history.isFetchingNextPage}
                >
                  {history.isFetchingNextPage && <Loader2 className="animate-spin" />}
                  {filtering ? 'Procurar mais' : 'Carregar mais 50'}
                </Button>
              ) : (
                entries.length > 0 && (
                  <p className="text-muted-foreground text-center text-xs">Começo do histórico.</p>
                )
              )}
              {history.isError && (
                <p className="text-destructive text-xs">{history.error.message}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
