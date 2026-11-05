import type { Project } from '@shared/types.ts';
import { GitCommitHorizontal, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { useCommitMessage } from '@/lib/commit-message';
import type { CheckedItem } from '@/lib/commit-selection';
import { displayPath, isRevertable, statusLabel } from '@/lib/status';
import { cn, firstLine } from '@/lib/utils';

interface CommitPanelProps {
  items: CheckedItem[];
  /** Modelo da referência (`tarefa #{n}`); sem modelo, o campo não aparece. */
  template: string | null;
  draft: ReturnType<typeof useCommitMessage>;
  onUncheck: (keys: string[]) => void;
  onCommit: () => void;
  /** Reverte os itens marcados (com confirmação). */
  onRevert: () => void;
}

/** Painel fixo embaixo da lista: o que está marcado para o commit, por projeto, e a mensagem. */
export function CommitPanel({
  items,
  template,
  draft,
  onUncheck,
  onCommit,
  onRevert,
}: CommitPanelProps) {
  const byProject = new Map<Project, CheckedItem[]>();
  for (const item of items)
    byProject.set(item.project, [...(byProject.get(item.project) ?? []), item]);
  const [prefix, suffix] = template?.includes('{n}') ? template.split('{n}', 2) : [template, ''];

  return (
    <div className="space-y-2 border-t p-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-medium">Commit</span>
        <span className="text-muted-foreground text-xs">
          {items.length} {items.length === 1 ? 'marcado' : 'marcados'}
        </span>
        <div className="flex-1" />
        {items.length > 0 && (
          <Button variant="ghost" size="xs" onClick={() => onUncheck(items.map((i) => i.key))}>
            Limpar
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground px-1 text-xs">
          Marque arquivos na lista Locais, de um ou de vários projetos.
        </p>
      ) : (
        <div className="max-h-28 overflow-y-auto rounded-md border px-1 py-0.5">
          {[...byProject].map(([project, projectItems]) => (
            <div key={project.id}>
              <div className="text-muted-foreground px-1 pt-0.5 text-[11px] font-semibold">
                {project.name}
              </div>
              {projectItems.map(({ key, change }) => {
                const status = statusLabel(change);
                return (
                  <div key={key} className="group flex items-center gap-1.5 px-1 font-mono text-xs">
                    <span className={cn('w-3 shrink-0', status.className)}>{status.letter}</span>
                    <span className="min-w-0 flex-1 truncate" title={displayPath(change)}>
                      {displayPath(change)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUncheck([key])}
                      className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
                      aria-label={`Desmarcar ${displayPath(change)}`}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {template && (
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground shrink-0 font-mono text-xs">{prefix}</span>
          <Input
            value={draft.reference}
            onChange={(e) => draft.setReference(e.target.value)}
            className="h-7 font-mono text-xs"
            aria-label="Referência"
          />
          {suffix && (
            <span className="text-muted-foreground shrink-0 font-mono text-xs">{suffix}</span>
          )}
        </label>
      )}
      <Textarea
        value={draft.text}
        onChange={(e) => draft.setText(e.target.value)}
        rows={3}
        placeholder={template ? 'Mensagem (opcional com a referência)' : 'Mensagem do commit'}
        className="min-h-0 text-sm"
        aria-label="Mensagem do commit"
      />
      <div className="flex items-center gap-2">
        {draft.history.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && draft.reuse(e.target.value)}
            className="border-input dark:bg-input/30 h-8 min-w-0 flex-1 rounded-md border bg-transparent px-1 text-xs"
            aria-label="Mensagens anteriores"
          >
            <option value="">Mensagens anteriores…</option>
            {draft.history.map((message) => (
              <option key={message} value={message}>
                {firstLine(message)}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={onRevert}
          disabled={!items.some((i) => isRevertable(i.change))}
          title="Desfaz as mudanças locais dos itens marcados (com confirmação); não versionados ficam de fora"
        >
          <Undo2 />
          Reverter…
        </Button>
        <Button
          size="sm"
          onClick={onCommit}
          disabled={items.length === 0 || draft.message === ''}
          title={draft.message === '' ? 'Escreva a mensagem ou a referência' : undefined}
        >
          <GitCommitHorizontal />
          Comitar…
        </Button>
      </div>
    </div>
  );
}
