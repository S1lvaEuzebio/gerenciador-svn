import type { ConflictDetails, MergeChoice, ResolveAccept, TreeConflict } from '@shared/types.ts';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConflict, useResolve, useSaveMerge } from '@/lib/queries';
import { cn, formatBytes } from '@/lib/utils';
import { CommandBlock, ConfirmDialog, LockNotice } from './ConfirmDialog';
import { ConflictMerge } from './ConflictMerge';
import type { FileSelection } from './DiffPanel';
import { MergeEditor } from './MergeEditor';
import { Placeholder } from './Placeholder';

interface AcceptText {
  label: string;
  title: string;
  description: string;
}

/** Textos das opções de `svn resolve`. Arquivo inteiro descarta um dos lados por completo. */
const ACCEPT_TEXT: Record<ResolveAccept, AcceptText> = {
  'mine-conflict': {
    label: 'Manter os meus nos conflitos',
    title: 'Manter a sua versão nos trechos em conflito',
    description:
      'Nos trechos em conflito fica a sua versão. O que veio do servidor sem conflito continua no arquivo.',
  },
  'theirs-conflict': {
    label: 'Usar os do servidor nos conflitos',
    title: 'Usar a versão do servidor nos trechos em conflito',
    description:
      'Nos trechos em conflito fica a versão do servidor. As suas mudanças sem conflito continuam no arquivo.',
  },
  'mine-full': {
    label: 'Minha versão',
    title: 'Arquivo inteiro: manter a sua versão',
    description:
      'O arquivo inteiro fica com a sua versão. Tudo o que veio do servidor neste arquivo é descartado.',
  },
  'theirs-full': {
    label: 'Versão do servidor',
    title: 'Arquivo inteiro: usar a versão do servidor',
    description:
      'O arquivo inteiro fica com a versão do servidor. Todas as suas mudanças locais neste arquivo são descartadas.',
  },
};

/** Conflito só de propriedade: "por trecho" é o valor da propriedade. */
const PROPERTY_TEXT: Partial<Record<ResolveAccept, AcceptText>> = {
  'mine-conflict': {
    label: 'Manter o meu valor',
    title: 'Manter o seu valor da propriedade',
    description: 'A propriedade em conflito fica com o seu valor.',
  },
  'theirs-conflict': {
    label: 'Usar o valor do servidor',
    title: 'Usar o valor da propriedade do servidor',
    description: 'A propriedade em conflito fica com o valor que veio do servidor.',
  },
};

const isFull = (accept: ResolveAccept) => accept === 'mine-full' || accept === 'theirs-full';

const ACTION: Record<string, string> = {
  edit: 'alterou',
  delete: 'apagou',
  add: 'adicionou',
  replace: 'substituiu',
};
const REASON: Record<string, string> = {
  edit: 'alterado',
  delete: 'apagado',
  missing: 'faltando',
  obstructed: 'obstruído',
  add: 'adicionado',
  replace: 'substituído',
  unversioned: 'não versionado',
  'moved-away': 'movido para outro lugar',
  'moved-here': 'movido para cá',
};

function TreeConflictView({ tree }: { tree: TreeConflict }) {
  const node = tree.kind === 'dir' ? 'esta pasta' : 'este arquivo';
  return (
    <div className="space-y-3 p-4 text-sm">
      <p>
        No {tree.operation || 'update'}, o servidor {ACTION[tree.action] ?? tree.action} {node}, que
        na sua cópia está {REASON[tree.reason] ?? tree.reason}.
      </p>
      <p className="text-muted-foreground">
        Conflito de árvore não é resolvido pelo app. No terminal, veja o detalhe com o primeiro
        comando; depois de deixar os arquivos como devem ficar, marque como resolvido com o segundo.
      </p>
      <CommandBlock commands={tree.commands} />
    </div>
  );
}

function Sizes({
  sizes,
  theirsRevision,
}: {
  sizes: { mine: number | null; theirs: number | null; base: number | null };
  theirsRevision: number | null;
}) {
  const item = (label: string, size: number | null) =>
    size !== null && (
      <li>
        {label}: {formatBytes(size)}
      </li>
    );
  return (
    <ul className="text-muted-foreground font-mono text-xs">
      {item('sua versão', sizes.mine)}
      {item(theirsRevision !== null ? `servidor (r${theirsRevision})` : 'servidor', sizes.theirs)}
      {item('base', sizes.base)}
    </ul>
  );
}

type Pending =
  { kind: 'resolve'; accept: ResolveAccept } | { kind: 'merge'; choices: MergeChoice[] };

/**
 * Painel de um caminho em conflito. Texto: resolver todos os trechos de um lado, o arquivo
 * inteiro de um lado, ou mesclar trecho a trecho. Binário: só o arquivo inteiro. Propriedade:
 * o valor de um lado. Árvore: orienta a usar o terminal.
 */
export function ConflictPanel({
  selection,
  locked,
  onUnlock,
}: {
  selection: FileSelection;
  locked: boolean;
  onUnlock: () => void;
}) {
  const [force, setForce] = useState(false);
  const details = useConflict(selection.projectId, selection.path, force);
  const resolve = useResolve(selection.projectId, selection.path);
  const merge = useSaveMerge(selection.projectId, selection.path);
  const [pending, setPending] = useState<Pending | null>(null);
  const [view, setView] = useState<'merge' | 'compare'>('merge');

  const header = (
    <div className="border-b px-3 py-2">
      <div className="truncate font-mono text-sm" title={selection.path}>
        {selection.path || '(pasta do projeto)'}
      </div>
      <div className="text-destructive flex items-center gap-1 text-xs">
        <AlertTriangle className="size-3" />
        {selection.projectName} · em conflito
      </div>
    </div>
  );

  if (details.isPending || details.isError) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <Placeholder>
          {details.isPending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <span className="text-destructive">{details.error.message}</span>
          )}
        </Placeholder>
      </div>
    );
  }

  const data: ConflictDetails = details.data;
  const text = data.text;
  const propertyOnly = !text && data.property !== undefined;
  const textFor = (accept: ResolveAccept) =>
    (propertyOnly ? PROPERTY_TEXT[accept] : undefined) ?? ACCEPT_TEXT[accept];
  const accepts = Object.keys(data.accepts) as ResolveAccept[];
  const partial = accepts.filter((a) => !isFull(a));
  const full = accepts.filter(isFull);

  const actionButtons = accepts.length > 0 && (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      {partial.map((accept) => (
        <Button
          key={accept}
          size="sm"
          variant="outline"
          disabled={locked}
          onClick={() => setPending({ kind: 'resolve', accept })}
        >
          {textFor(accept).label}
        </Button>
      ))}
      {full.length > 0 && (
        <div className="ml-auto flex items-center gap-1">
          <span className="text-muted-foreground text-xs">
            {text?.binary ? 'Escolha a versão:' : 'Arquivo inteiro:'}
          </span>
          {full.map((accept) => (
            <Button
              key={accept}
              size={text?.binary ? 'sm' : 'xs'}
              variant={text?.binary ? 'outline' : 'ghost'}
              disabled={locked}
              onClick={() => setPending({ kind: 'resolve', accept })}
            >
              {textFor(accept).label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );

  let body;
  if (text && !text.binary) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-4 border-b px-3">
          {(['merge', 'compare'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={cn(
                'border-b-2 px-1 py-1.5 text-xs',
                view === value
                  ? 'border-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {value === 'merge' ? 'Mesclar trecho a trecho' : 'Comparar minha × servidor'}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {text.tooLarge ? (
            <Placeholder>
              <p>
                Arquivo grande (
                {formatBytes(Math.max(text.sizes.mine ?? 0, text.sizes.theirs ?? 0))}). Comparar e
                mesclar pode deixar a tela lenta.
              </p>
              <Button variant="outline" size="sm" onClick={() => setForce(true)}>
                Abrir mesmo assim
              </Button>
            </Placeholder>
          ) : view === 'compare' ? (
            text.compare ? (
              <MergeEditor
                original={text.compare.mine}
                modified={text.compare.theirs}
                path={selection.path}
                mode="split"
                ignoreWhitespace={false}
              />
            ) : (
              <Placeholder>
                Comparação indisponível: faltam as versões guardadas do conflito.
              </Placeholder>
            )
          ) : text.merge ? (
            <ConflictMerge
              key={text.merge.fingerprint}
              segments={text.merge.segments}
              eol={text.merge.eol}
              baseRevision={text.baseRevision}
              theirsRevision={text.theirsRevision}
              disabled={locked || data.mergeCommand === null}
              onSave={(choices) => setPending({ kind: 'merge', choices })}
            />
          ) : (
            <Placeholder>
              Editor de mesclagem indisponível: {text.mergeUnavailable}. Use os botões acima.
            </Placeholder>
          )}
        </div>
      </div>
    );
  } else if (text) {
    body = (
      <Placeholder>
        <p>Arquivo binário em conflito: escolha qual versão fica.</p>
        <Sizes sizes={text.sizes} theirsRevision={text.theirsRevision} />
      </Placeholder>
    );
  } else if (data.property !== undefined) {
    body = (
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="text-muted-foreground pb-1 text-xs font-medium uppercase">
          Conflito de propriedade
        </div>
        <pre className="font-mono text-xs whitespace-pre-wrap">{data.property}</pre>
      </div>
    );
  } else if (data.tree) {
    body = <TreeConflictView tree={data.tree} />;
  } else {
    body = <Placeholder>O svn não informou conflito neste caminho.</Placeholder>;
  }

  const confirmText =
    pending?.kind === 'resolve'
      ? textFor(pending.accept)
      : {
          title: 'Gravar a mesclagem',
          description:
            'O arquivo vai ser gravado com as escolhas de cada trecho, mantendo o fim de linha, e o conflito marcado como resolvido.',
        };
  const confirmCommand =
    pending?.kind === 'resolve' ? data.accepts[pending.accept]! : (data.mergeCommand ?? '');
  const mutation = pending?.kind === 'merge' ? merge : resolve;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {locked && accepts.length > 0 && (
        <div className="border-b p-2">
          <LockNotice kind="local" onUnlock={onUnlock} />
        </div>
      )}
      {data.tree && text && <TreeConflictView tree={data.tree} />}
      {actionButtons}
      {body}
      {data.auxFiles.length > 0 && (
        <p className="text-muted-foreground border-t px-3 py-1.5 text-xs">
          Arquivos auxiliares do svn, que somem ao resolver: {data.auxFiles.join(', ')}
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            resolve.reset();
            merge.reset();
          }
        }}
        title={confirmText.title}
        description={
          <>
            <p>{confirmText.description}</p>
            {pending?.kind === 'resolve' && !propertyOnly && (
              <p>
                O svn monta o resultado a partir das versões guardadas no conflito: edições feitas
                no arquivo depois do update se perdem.
              </p>
            )}
            {text && data.property !== undefined && (
              <p className="text-warning-foreground">
                Este arquivo também tem conflito de propriedade, que vai ser marcado como resolvido
                junto
                {pending?.kind === 'merge'
                  ? ', com o valor atual da cópia local.'
                  : pending?.kind === 'resolve' && pending.accept.startsWith('theirs')
                    ? ', com o valor do servidor.'
                    : ', com o seu valor.'}
              </p>
            )}
          </>
        }
        command={confirmCommand}
        confirmLabel={pending?.kind === 'merge' ? 'Gravar' : 'Resolver'}
        destructive={pending?.kind === 'resolve' && isFull(pending.accept)}
        pending={mutation.isPending}
        error={mutation.error}
        onConfirm={() => {
          if (!pending) return;
          const done = { onSuccess: () => setPending(null) };
          if (pending.kind === 'resolve') resolve.mutate(pending.accept, done);
          else if (text?.merge) {
            merge.mutate({ fingerprint: text.merge.fingerprint, choices: pending.choices }, done);
          }
        }}
      />
    </div>
  );
}
