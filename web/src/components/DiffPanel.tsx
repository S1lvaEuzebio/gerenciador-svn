import type { DiffResponse, Eol } from '@shared/types.ts';
import { FileDiff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useDiff } from '@/lib/queries';
import { useStoredState } from '@/lib/use-stored-state';
import { cn, formatBytes } from '@/lib/utils';
import { MergeEditor, type DiffMode } from './MergeEditor';
import { Placeholder } from './Placeholder';

export interface FileSelection {
  projectId: string;
  projectName: string;
  path: string;
}

const EOL_LABEL: Record<Eol, string> = { crlf: 'CRLF', lf: 'LF', mixed: 'misto', none: '—' };

const isDiffMode = (value: string): value is DiffMode => value === 'split' || value === 'unified';
const isFlag = (value: string): value is 'on' | 'off' => value === 'on' || value === 'off';

/** Diff de propriedades; `fill` ocupa o painel inteiro (pasta só com mudança de propriedade). */
function PropsDiff({ text, fill = false }: { text: string; fill?: boolean }) {
  return (
    <div className={cn(fill ? 'flex h-full min-h-0 flex-col' : 'border-t')}>
      <div className="text-muted-foreground px-3 pt-2 text-xs font-medium uppercase">
        Propriedades
      </div>
      <pre
        className={cn(
          'overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap',
          fill ? 'min-h-0 flex-1' : 'max-h-48',
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function eolNotice(eol: { original: Eol; modified: Eol }): string | null {
  if (eol.original !== 'none' && eol.modified !== 'none' && eol.original !== eol.modified) {
    return `Fim de linha mudou: ${EOL_LABEL[eol.original]} → ${EOL_LABEL[eol.modified]}`;
  }
  if (eol.modified === 'mixed') return 'Arquivo com fim de linha misto (CRLF e LF)';
  return null;
}

function DiffBody({
  diff,
  path,
  mode,
  ignoreWhitespace,
  onForce,
}: {
  diff: DiffResponse;
  path: string;
  mode: DiffMode;
  ignoreWhitespace: boolean;
  onForce: () => void;
}) {
  switch (diff.kind) {
    case 'too-large':
      return (
        <Placeholder>
          <p>
            Arquivo grande ({formatBytes(Math.max(diff.originalSize ?? 0, diff.modifiedSize))}).
            Mostrar o diff pode deixar a tela lenta.
          </p>
          <Button variant="outline" size="sm" onClick={onForce}>
            Mostrar mesmo assim
          </Button>
        </Placeholder>
      );
    case 'binary':
      return (
        <div className="flex h-full flex-col">
          <Placeholder>
            <p>Arquivo binário alterado.</p>
            <p className="font-mono text-xs">
              {diff.originalSize !== null && `base ${formatBytes(diff.originalSize)} → `}local{' '}
              {formatBytes(diff.modifiedSize)}
            </p>
          </Placeholder>
          {diff.propsDiff && <PropsDiff text={diff.propsDiff} />}
        </div>
      );
    case 'directory':
      return diff.propsDiff ? (
        <PropsDiff text={diff.propsDiff} fill />
      ) : (
        <Placeholder>
          {diff.item === 'unversioned'
            ? 'Pasta não versionada.'
            : 'Pasta sem mudanças de propriedade.'}
        </Placeholder>
      );
    case 'text': {
      const notice = eolNotice(diff.eol);
      const sameContent =
        diff.original.replace(/\r\n/g, '\n') === diff.modified.replace(/\r\n/g, '\n');
      return (
        <div className="flex h-full min-h-0 flex-col">
          {notice && (
            <div className="bg-warning text-warning-foreground px-3 py-1 text-xs">{notice}</div>
          )}
          <div className="min-h-0 flex-1">
            {sameContent ? (
              <Placeholder>Sem diferenças de conteúdo.</Placeholder>
            ) : (
              <MergeEditor
                original={diff.original}
                modified={diff.modified}
                path={path}
                mode={mode}
                ignoreWhitespace={ignoreWhitespace}
              />
            )}
          </div>
          {diff.propsDiff && <PropsDiff text={diff.propsDiff} />}
        </div>
      );
    }
  }
}

/** Painel direito: diff "minhas mudanças" (cópia local × BASE) do arquivo selecionado. */
export function DiffPanel({ selection }: { selection: FileSelection | null }) {
  const [force, setForce] = useState(false);
  const [mode, setMode] = useStoredState<DiffMode>('diff-mode', 'split', isDiffMode);
  const [whitespace, setWhitespace] = useStoredState<'on' | 'off'>('diff-ignore-ws', 'off', isFlag);
  const diff = useDiff(selection, force);

  if (!selection) {
    return (
      <Placeholder>
        <FileDiff className="size-8 opacity-40" />
        Selecione um arquivo para ver o diff.
      </Placeholder>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm" title={selection.path}>
            {selection.path || '(pasta do projeto)'}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {selection.projectName} · minhas mudanças (local × base)
          </div>
        </div>
        <div className="flex items-center rounded-md border p-0.5">
          {(['split', 'unified'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                mode === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
            >
              {value === 'split' ? 'Lado a lado' : 'Unificado'}
            </button>
          ))}
        </div>
        <Label className="text-xs font-normal">
          <Checkbox
            checked={whitespace === 'on'}
            onCheckedChange={(checked) => setWhitespace(checked === true ? 'on' : 'off')}
          />
          Ignorar espaços
        </Label>
      </div>
      <div className="min-h-0 flex-1">
        {diff.isPending ? (
          <Placeholder>
            <Loader2 className="size-5 animate-spin" />
          </Placeholder>
        ) : diff.isError ? (
          <Placeholder>
            <span className="text-destructive">{diff.error.message}</span>
          </Placeholder>
        ) : (
          <DiffBody
            diff={diff.data}
            path={selection.path}
            mode={mode}
            ignoreWhitespace={whitespace === 'on'}
            onForce={() => setForce(true)}
          />
        )}
      </div>
    </div>
  );
}
