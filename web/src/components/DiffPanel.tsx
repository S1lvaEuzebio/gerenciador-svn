import type {
  DiffCompare,
  DiffResponse,
  Eol,
  ProjectRemoteStatus,
  RemoteItem,
} from '@shared/types.ts';
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
  /** Lista de onde veio: mudanças locais ou o que vai chegar do servidor. */
  source: 'local' | 'incoming';
  projectId: string;
  projectName: string;
  path: string;
}

const COMPARE_LABELS: Record<DiffCompare, string> = {
  local: 'Minhas mudanças',
  incoming: 'O que vai chegar',
  'local-head': 'Local × servidor',
};

/** Nomes dos dois lados do diff, na ordem esquerda → direita. */
function sideNames(compare: DiffCompare, revision: number | null): [string, string] {
  const server = revision === null ? 'servidor' : `servidor r${revision}`;
  switch (compare) {
    case 'local':
      return ['base', 'local'];
    case 'incoming':
      return ['base', server];
    case 'local-head':
      return [server, 'local'];
  }
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
  sides,
  serverItem,
  mode,
  ignoreWhitespace,
  onForce,
}: {
  diff: DiffResponse;
  path: string;
  sides: [string, string];
  /** O que muda no servidor neste caminho, nos diffs que envolvem o servidor. */
  serverItem: RemoteItem | null;
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

/**
 * Painel direito: diff do arquivo selecionado. Da lista local o padrão é "minhas mudanças";
 * da lista do servidor, "o que vai chegar". Os dois oferecem comparar a cópia local com o
 * servidor, na revisão do último status remoto do projeto (`remote`).
 */
export function DiffPanel({
  selection,
  remote,
}: {
  selection: FileSelection | null;
  remote: ProjectRemoteStatus | undefined;
}) {
  const headRevision = remote?.headRevision ?? null;
  const incoming = remote?.incoming.find((c) => c.path === selection?.path);
  const [force, setForce] = useState(false);
  const [mode, setMode] = useStoredState<DiffMode>('diff-mode', 'split', isDiffMode);
  const [whitespace, setWhitespace] = useStoredState<'on' | 'off'>('diff-ignore-ws', 'off', isFlag);
  const options: DiffCompare[] =
    selection?.source === 'incoming' ? ['incoming', 'local-head'] : ['local', 'local-head'];
  const [compare, setCompare] = useState<DiffCompare>(options[0]!);
  const revision = compare === 'local' ? null : headRevision;
  const diff = useDiff(
    selection && { projectId: selection.projectId, path: selection.path, compare, revision, force },
  );
  const sides = sideNames(compare, headRevision);

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
            {selection.projectName} · {sides[0]} × {sides[1]}
          </div>
        </div>
        <div className="flex items-center rounded-md border p-0.5">
          {options.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCompare(value)}
              disabled={value !== 'local' && headRevision === null}
              title={
                value !== 'local' && headRevision === null
                  ? 'Status do servidor ainda não carregado'
                  : undefined
              }
              className={cn(
                'rounded px-2 py-0.5 text-xs disabled:opacity-50',
                compare === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
            >
              {COMPARE_LABELS[value]}
            </button>
          ))}
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
            sides={sides}
            serverItem={compare === 'local' ? null : (incoming?.item ?? null)}
            mode={mode}
            ignoreWhitespace={whitespace === 'on'}
            onForce={() => setForce(true)}
          />
        )}
      </div>
    </div>
  );
}
