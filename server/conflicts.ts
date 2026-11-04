import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import type {
  CommandResult,
  ConflictDetails,
  ConflictSegment,
  MergeChoice,
  Project,
  ResolveAccept,
  TextConflict,
} from '../shared/types.ts';
import { detectEol, isBinary, MAX_DIFF_BYTES } from './diff.ts';
import { HttpError } from './http-error.ts';
import { formatCommand } from './console-log.ts';
import { relativeToProject, resolveInProject } from './projects.ts';
import { svnConflictInfo, type ConflictFiles } from './svn/info.ts';
import { runSvn, svnCommandLine } from './svn/run.ts';
import { enqueue } from './wc-queue.ts';

// `ignoreBOM` mantém o BOM no texto, para ele voltar ao arquivo quando a mesclagem for gravada.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decodeUtf8(buffer: Buffer): string | null {
  try {
    return utf8.decode(buffer);
  } catch {
    return null;
  }
}

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

const START = /^<{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const SEPARATOR = /^={7}$/;
const END = /^>{7}(?: |$)/;

/**
 * Separa o arquivo em trechos comuns e trechos em conflito, pelos marcadores que o svn grava
 * (`<<<<<<< .mine`, `||||||| .rOLD`, `=======`, `>>>>>>> .rNEW`). Cada linha mantém o próprio
 * fim de linha. Devolve `null` se não houver marcadores ou se estiverem fora de ordem.
 */
export function parseConflictMarkers(text: string): ConflictSegment[] | null {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const segments: ConflictSegment[] = [];
  let state: 'text' | 'mine' | 'base' | 'theirs' = 'text';
  let common = '';
  let mine = '';
  let base: string | null = null;
  let theirs = '';

  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '');
    switch (state) {
      case 'text':
        if (START.test(bare)) {
          if (common !== '') segments.push({ kind: 'text', text: common });
          common = '';
          mine = '';
          base = null;
          theirs = '';
          state = 'mine';
        } else {
          common += line;
        }
        break;
      case 'mine':
        if (BASE.test(bare)) {
          base = '';
          state = 'base';
        } else if (SEPARATOR.test(bare)) {
          state = 'theirs';
        } else if (START.test(bare) || END.test(bare)) {
          return null;
        } else {
          mine += line;
        }
        break;
      case 'base':
        if (SEPARATOR.test(bare)) state = 'theirs';
        else if (START.test(bare) || END.test(bare)) return null;
        else base += line;
        break;
      case 'theirs':
        if (END.test(bare)) {
          segments.push({ kind: 'conflict', mine, base, theirs });
          state = 'text';
        } else if (START.test(bare) || BASE.test(bare) || SEPARATOR.test(bare)) {
          return null;
        } else {
          theirs += line;
        }
        break;
    }
  }
  if (state !== 'text') return null;
  if (common !== '') segments.push({ kind: 'text', text: common });
  return segments.some((s) => s.kind === 'conflict') ? segments : null;
}

/** Fim de linha mais usado no arquivo; é o que o texto editado à mão recebe. */
function dominantEol(text: string): '\r\n' | '\n' {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

function applyChoice(
  segment: Extract<ConflictSegment, { kind: 'conflict' }>,
  choice: MergeChoice,
  eol: string,
): string {
  if ('edit' in choice) {
    const text = choice.edit.replace(/\r\n|\r|\n/g, eol);
    return text === '' || text.endsWith(eol) ? text : text + eol;
  }
  switch (choice.pick) {
    case 'mine':
      return segment.mine;
    case 'theirs':
      return segment.theirs;
    case 'both':
      return segment.mine + segment.theirs;
  }
}

/** Arquivo auxiliar do conflito, conferindo que está dentro do projeto. */
function auxPath(project: Project, path: string): string {
  return resolveInProject(project, relativeToProject(project, path));
}

async function sizeOf(path: string | undefined): Promise<number | null> {
  if (!path) return null;
  return stat(path).then(
    (info) => info.size,
    () => null,
  );
}

async function textConflict(
  project: Project,
  absolute: string,
  files: ConflictFiles,
): Promise<TextConflict> {
  const minePath = files.mine ? auxPath(project, files.mine) : absolute;
  const theirsPath = files.theirs ? auxPath(project, files.theirs) : undefined;
  const basePath = files.base ? auxPath(project, files.base) : undefined;
  const sizes = {
    mine: await sizeOf(minePath),
    base: await sizeOf(basePath),
    theirs: await sizeOf(theirsPath),
  };
  // Em conflito binário o svn não grava `.mine`: o próprio arquivo é a versão local.
  const working = await readFile(absolute).catch(() => null);
  const theirs = theirsPath ? await readFile(theirsPath).catch(() => null) : null;
  const binary = !files.mine || (working !== null && isBinary(working));
  const result: TextConflict = {
    binary,
    baseRevision: files.baseRevision,
    theirsRevision: files.theirsRevision,
    sizes,
    compare: null,
    merge: null,
  };
  if (binary) return { ...result, mergeUnavailable: 'arquivo binário' };

  const tooLarge =
    Math.max(sizes.mine ?? 0, sizes.theirs ?? 0, working?.length ?? 0) > MAX_DIFF_BYTES;
  if (!tooLarge && theirs) {
    const mine = await readFile(minePath).catch(() => null);
    if (mine) result.compare = { mine: mine.toString('utf8'), theirs: theirs.toString('utf8') };
  }
  if (!working) return { ...result, mergeUnavailable: 'o arquivo não está no disco' };
  if (tooLarge) return { ...result, mergeUnavailable: 'arquivo maior que 1 MB' };
  const text = decodeUtf8(working);
  if (text === null) return { ...result, mergeUnavailable: 'o arquivo não está em UTF-8' };
  const segments = parseConflictMarkers(text);
  if (!segments) {
    return {
      ...result,
      mergeUnavailable: 'não achei os marcadores de conflito do svn no arquivo',
    };
  }
  return { ...result, merge: { segments, fingerprint: sha256(working), eol: detectEol(text) } };
}

const resolveArgs = (accept: ResolveAccept | 'working', absolute: string) => [
  'resolve',
  '--accept',
  accept,
  absolute,
];

export async function conflictDetails(
  project: Project,
  relativePath: string,
): Promise<ConflictDetails> {
  const absolute = resolveInProject(project, relativePath);
  const info = await svnConflictInfo(absolute);
  const textFiles = info.conflicts.find((c) => c.type === 'text');
  const propFiles = info.conflicts.find((c) => c.type === 'property');

  const text = textFiles ? await textConflict(project, absolute, textFiles) : undefined;
  const property = propFiles?.prej
    ? await readFile(auxPath(project, propFiles.prej), 'utf8').catch(() => '')
    : undefined;

  // Binário só aceita o arquivo inteiro; propriedade sozinha, só "por trecho" (o valor).
  // Conflito de árvore fica para o terminal.
  const options: ResolveAccept[] = text
    ? text.binary
      ? ['mine-full', 'theirs-full']
      : ['mine-conflict', 'theirs-conflict', 'mine-full', 'theirs-full']
    : propFiles
      ? ['mine-conflict', 'theirs-conflict']
      : [];
  const auxFiles = [textFiles?.base, textFiles?.mine, textFiles?.theirs, propFiles?.prej]
    .filter((p): p is string => p !== undefined)
    .map((p) => relativeToProject(project, p));

  return {
    path: relativePath,
    text,
    property,
    tree: info.tree && {
      ...info.tree,
      commands: [
        formatCommand(['info', absolute]),
        formatCommand(['resolve', '--accept', 'working', absolute]),
      ],
    },
    auxFiles,
    accepts: Object.fromEntries(
      options.map((accept) => [accept, svnCommandLine(resolveArgs(accept, absolute))]),
    ),
    mergeCommand: text?.merge ? svnCommandLine(resolveArgs('working', absolute)) : null,
  };
}

export function resolveConflict(
  project: Project,
  relativePath: string,
  accept: ResolveAccept,
): Promise<CommandResult> {
  const args = resolveArgs(accept, resolveInProject(project, relativePath));
  return enqueue(project.id, async () => ({
    command: svnCommandLine(args),
    output: await runSvn(args),
  }));
}

/**
 * Grava o resultado do editor de mesclagem e marca o conflito como resolvido. Recusa se o
 * arquivo mudou desde que foi aberto (`fingerprint`). Trechos não escolhidos e linhas comuns
 * mantêm o fim de linha original; texto editado recebe o fim de linha dominante do arquivo.
 */
export function saveMerge(
  project: Project,
  relativePath: string,
  fingerprint: string,
  choices: MergeChoice[],
): Promise<CommandResult> {
  const absolute = resolveInProject(project, relativePath);
  return enqueue(project.id, async () => {
    const buffer = await readFile(absolute);
    if (sha256(buffer) !== fingerprint) {
      throw new HttpError(409, 'o arquivo mudou desde que foi aberto; recarregue o conflito');
    }
    const text = decodeUtf8(buffer);
    const segments = text === null ? null : parseConflictMarkers(text);
    if (text === null || !segments) {
      throw new HttpError(409, 'não achei os marcadores de conflito no arquivo');
    }
    const conflicts = segments.filter((s) => s.kind === 'conflict').length;
    if (choices.length !== conflicts) {
      throw new HttpError(400, `${choices.length} escolhas para ${conflicts} trechos em conflito`);
    }
    const eol = dominantEol(text);
    let next = 0;
    const merged = segments
      .map((s) => (s.kind === 'text' ? s.text : applyChoice(s, choices[next++]!, eol)))
      .join('');
    await writeFile(absolute, merged, 'utf8');

    const args = resolveArgs('working', absolute);
    return { command: svnCommandLine(args), output: await runSvn(args) };
  });
}
