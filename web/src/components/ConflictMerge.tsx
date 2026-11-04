import type { ConflictSegment, Eol, MergeChoice } from '@shared/types.ts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Conflict = Extract<ConflictSegment, { kind: 'conflict' }>;

const CONTEXT_LINES = 3;

/** Linhas para mostrar na tela: sem `\r` e sem a quebra final. */
function toLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function Code({ text, className }: { text: string; className?: string }) {
  const lines = toLines(text);
  return (
    <pre className={cn('overflow-x-auto px-2 py-1 font-mono text-xs leading-5', className)}>
      {lines.length === 0 ? (
        <span className="text-muted-foreground italic">(vazio)</span>
      ) : (
        lines.join('\n')
      )}
    </pre>
  );
}

/** Trecho sem conflito: mostra só as linhas em volta dos conflitos, com o resto recolhido. */
function CommonText({ text, first, last }: { text: string; first: boolean; last: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lines = toLines(text);
  const head = first ? 0 : CONTEXT_LINES;
  const tail = last ? 0 : CONTEXT_LINES;
  if (expanded || lines.length <= head + tail + 1) {
    return <Code text={lines.join('\n')} className="text-muted-foreground" />;
  }
  return (
    <div className="text-muted-foreground">
      {head > 0 && <Code text={lines.slice(0, head).join('\n')} />}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="hover:text-foreground w-full px-2 py-0.5 text-left text-xs italic"
      >
        … {lines.length - head - tail} linhas sem conflito
      </button>
      {tail > 0 && <Code text={lines.slice(-tail).join('\n')} />}
    </div>
  );
}

const PICKS: Array<{ pick: 'mine' | 'theirs' | 'both'; label: string }> = [
  { pick: 'mine', label: 'Minha' },
  { pick: 'theirs', label: 'Do servidor' },
  { pick: 'both', label: 'As duas' },
];

function ConflictCard({
  conflict,
  index,
  total,
  choice,
  onChoice,
  baseRevision,
  theirsRevision,
  disabled,
}: {
  conflict: Conflict;
  index: number;
  total: number;
  choice: MergeChoice | null;
  onChoice: (choice: MergeChoice) => void;
  baseRevision: number | null;
  theirsRevision: number | null;
  disabled: boolean;
}) {
  const [showBase, setShowBase] = useState(false);
  const picked = choice && 'pick' in choice ? choice.pick : null;
  const editing = choice !== null && 'edit' in choice;
  const mineChosen = picked === 'mine' || picked === 'both';
  const theirsChosen = picked === 'theirs' || picked === 'both';

  return (
    <div
      className={cn(
        'my-2 overflow-hidden rounded-md border',
        choice === null ? 'border-red-400 dark:border-red-500' : 'border-green-500',
      )}
    >
      <div className="bg-muted/60 flex flex-wrap items-center gap-2 px-2 py-1">
        <span className="text-xs font-medium">
          Trecho {index + 1} de {total}
        </span>
        <div className="flex-1" />
        {PICKS.map(({ pick, label }) => (
          <Button
            key={pick}
            size="xs"
            variant={picked === pick ? 'default' : 'outline'}
            onClick={() => onChoice({ pick })}
            disabled={disabled}
          >
            {label}
          </Button>
        ))}
        <Button
          size="xs"
          variant={editing ? 'default' : 'outline'}
          onClick={() =>
            onChoice({
              edit: toLines(picked === 'theirs' ? conflict.theirs : conflict.mine).join('\n'),
            })
          }
          disabled={disabled}
        >
          Editar
        </Button>
      </div>
      <div className="grid grid-cols-2 divide-x">
        <div className={cn(mineChosen && 'bg-green-500/10')}>
          <div className="text-muted-foreground px-2 pt-1 text-[11px] uppercase">Minha versão</div>
          <Code text={conflict.mine} />
        </div>
        <div className={cn(theirsChosen && 'bg-green-500/10')}>
          <div className="text-muted-foreground px-2 pt-1 text-[11px] uppercase">
            Servidor{theirsRevision !== null && ` (r${theirsRevision})`}
          </div>
          <Code text={conflict.theirs} />
        </div>
      </div>
      {conflict.base !== null && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setShowBase(!showBase)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-0.5 text-[11px] uppercase"
          >
            {showBase ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Base{baseRevision !== null && ` (r${baseRevision})`}: como era antes das duas mudanças
          </button>
          {showBase && <Code text={conflict.base} className="text-muted-foreground" />}
        </div>
      )}
      {choice !== null && 'edit' in choice && (
        <div className="border-t p-2">
          <Textarea
            value={choice.edit}
            onChange={(e) => onChoice({ edit: e.target.value })}
            rows={Math.min(12, Math.max(3, choice.edit.split('\n').length + 1))}
            className="font-mono text-xs"
            aria-label={`Texto do trecho ${index + 1}`}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

const EOL_NAME: Record<Eol, string> = { crlf: 'CRLF', lf: 'LF', mixed: 'misto', none: 'LF' };

/**
 * Editor de mesclagem: para cada trecho em conflito, fica a minha versão, a do servidor, as
 * duas ou um texto editado. Linhas sem conflito ficam como o svn mesclou.
 */
export function ConflictMerge({
  segments,
  eol,
  baseRevision,
  theirsRevision,
  disabled,
  onSave,
}: {
  segments: ConflictSegment[];
  eol: Eol;
  baseRevision: number | null;
  theirsRevision: number | null;
  disabled: boolean;
  onSave: (choices: MergeChoice[]) => void;
}) {
  const total = segments.filter((s) => s.kind === 'conflict').length;
  const [choices, setChoices] = useState<Array<MergeChoice | null>>(() => Array(total).fill(null));
  const decided = choices.filter((c) => c !== null).length;

  let conflictIndex = 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {segments.map((segment, i) => {
          if (segment.kind === 'text') {
            return (
              <CommonText
                key={i}
                text={segment.text}
                first={i === 0}
                last={i === segments.length - 1}
              />
            );
          }
          const index = conflictIndex++;
          return (
            <ConflictCard
              key={i}
              conflict={segment}
              index={index}
              total={total}
              choice={choices[index] ?? null}
              onChoice={(choice) =>
                setChoices((current) => current.map((c, j) => (j === index ? choice : c)))
              }
              baseRevision={baseRevision}
              theirsRevision={theirsRevision}
              disabled={disabled}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t px-3 py-2">
        <span className="text-muted-foreground text-xs">
          {decided} de {total} trechos decididos · fim de linha {EOL_NAME[eol]} preservado
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          disabled={disabled || decided < total}
          onClick={() => onSave(choices as MergeChoice[])}
        >
          Gravar e marcar como resolvido
        </Button>
      </div>
    </div>
  );
}
