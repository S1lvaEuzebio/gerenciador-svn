import type { DiffResponse, Eol, RemoteItem } from '@shared/types.ts';
import type { UseQueryResult } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { DiffDisplay } from '@/lib/use-diff-display';
import { cn, formatBytes } from '@/lib/utils';
import { MergeEditor } from './MergeEditor';
import { Placeholder } from './Placeholder';

const EOL_LABEL: Record<Eol, string> = { crlf: 'CRLF', lf: 'LF', mixed: 'misto', none: '—' };

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** Grupo de botões em que um fica marcado (tipo de comparação, lado a lado/unificado). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center rounded-md border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          title={option.title}
          className={cn(
            'rounded px-2 py-0.5 text-xs disabled:opacity-50',
            value === option.value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DiffDisplayControls({ display }: { display: DiffDisplay }) {
  return (
    <>
      <SegmentedControl
        options={[
          { value: 'split', label: 'Lado a lado' },
          { value: 'unified', label: 'Unificado' },
        ]}
        value={display.mode}
        onChange={display.setMode}
      />
      <Label className="text-xs font-normal">
        <Checkbox
          checked={display.ignoreWhitespace}
          onCheckedChange={(checked) => display.setIgnoreWhitespace(checked === true)}
        />
        Ignorar espaços
      </Label>
    </>
  );
}

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
  sides,
  serverItem,
  display,
  onForce,
}: {
  diff: DiffResponse;
  path: string;
  sides: [string, string];
  /** O que muda no servidor neste caminho, nos diffs que envolvem o servidor. */
  serverItem: RemoteItem | null;
  display: DiffDisplay;
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
              {diff.originalSize !== null && `${sides[0]} ${formatBytes(diff.originalSize)} → `}
              {sides[1]} {formatBytes(diff.modifiedSize)}
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
          {serverItem === 'added'
            ? 'Pasta nova no servidor.'
            : serverItem === 'deleted'
              ? 'Pasta apagada no servidor, com tudo o que tem dentro.'
              : diff.item === 'unversioned'
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
                mode={display.mode}
                ignoreWhitespace={display.ignoreWhitespace}
              />
            )}
          </div>
          {diff.propsDiff && <PropsDiff text={diff.propsDiff} />}
        </div>
      );
    }
  }
}

/** Resultado de um pedido de diff: carregando, erro ou o diff (texto, binário, grande, pasta). */
export function DiffResult({
  query,
  path,
  sides,
  serverItem = null,
  display,
  onForce,
}: {
  query: UseQueryResult<DiffResponse>;
  path: string;
  /** Nomes dos dois lados, na ordem esquerda → direita. */
  sides: [string, string];
  serverItem?: RemoteItem | null;
  display: DiffDisplay;
  onForce: () => void;
}) {
  if (query.isPending) {
    return (
      <Placeholder>
        <Loader2 className="size-5 animate-spin" />
      </Placeholder>
    );
  }
  if (query.isError) {
    return (
      <Placeholder>
        <span className="text-destructive">{query.error.message}</span>
      </Placeholder>
    );
  }
  return (
    <DiffBody
      diff={query.data}
      path={path}
      sides={sides}
      serverItem={serverItem}
      display={display}
      onForce={onForce}
    />
  );
}
