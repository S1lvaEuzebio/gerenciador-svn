import type { Stats } from 'node:fs';
import { lstat, open, readFile, readlink } from 'node:fs/promises';
import type { DiffCompare, DiffResponse, Eol, ItemStatus, Project } from '../shared/types.ts';
import { HttpError } from './http-error.ts';
import { projectPathUrl, resolveInProject } from './projects.ts';
import { svnInfo } from './svn/info.ts';
import { svnFileSize } from './svn/list.ts';
import { isNotFound, localTarget, runSvn, runSvnRaw } from './svn/run.ts';
import { svnStatus } from './svn/status.ts';

export const MAX_DIFF_BYTES = 1024 * 1024;

const BINARY_SNIFF_BYTES = 8000;

/** De onde vem cada lado do diff: BASE, arquivo no disco ou revisão do servidor. */
type Side = 'base' | 'working' | 'repo';

const SIDES: Record<DiffCompare, [Side, Side]> = {
  local: ['base', 'working'],
  incoming: ['base', 'repo'],
  'local-head': ['repo', 'working'],
};

/** Mesma heurística do git: byte nulo nos primeiros 8000 bytes indica binário. */
export function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, BINARY_SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Quantas quebras de linha CRLF e LF (sozinho) o texto tem. */
export function countEols(text: string): { crlf: number; lf: number } {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  return { crlf, lf: (text.match(/\n/g) ?? []).length - crlf };
}

export function detectEol(text: string): Eol {
  const { crlf, lf } = countEols(text);
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf > 0) return 'mixed';
  return crlf > 0 ? 'crlf' : 'lf';
}

/** `path` é um caminho da working copy ou uma URL com revisão. */
export async function propsDiff(path: string, revisionArgs: string[]): Promise<string | undefined> {
  try {
    const text = await runSvn([
      'diff',
      ...revisionArgs,
      '--depth',
      'empty',
      '--properties-only',
      localTarget(path),
    ]);
    return text.trim() === '' ? undefined : text;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

/** Conteúdo no servidor; caminho que não existe nessa revisão (apagado) vira vazio. */
async function catRepo(url: string): Promise<Buffer> {
  try {
    return await runSvnRaw(['cat', url]);
  } catch (error) {
    if (isNotFound(error)) return Buffer.alloc(0);
    throw error;
  }
}

/**
 * Diff de propriedades rodando em paralelo com o resto. Nem todo retorno espera por ele; sem o
 * `catch`, uma falha dele derrubaria o processo como rejeição não tratada. Quem faz `await`
 * continua recebendo o erro.
 */
export function noUnhandledRejection<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/** Um lado do diff: nada, a BASE da working copy, o arquivo no disco ou um nó do servidor. */
export type Source =
  | { from: 'none' }
  | { from: 'base'; path: string }
  | { from: 'working'; path: string; size: number; isLink: boolean }
  | { from: 'repo'; url: string };

/** Lado que não existe: caminho novo, apagado ou fora do disco. */
export const ABSENT: Source = { from: 'none' };

/** Arquivo de trabalho como lado do diff; sem arquivo (ou pasta), nada. */
export function workingSource(path: string, info: Stats | null): Source {
  return info && !info.isDirectory()
    ? { from: 'working', path, size: info.size, isLink: info.isSymbolicLink() }
    : ABSENT;
}

/** Tamanho que dá para saber sem ler o conteúdo; a BASE só lendo. */
async function sizeBeforeReading(source: Source): Promise<number | null> {
  switch (source.from) {
    case 'none':
      return 0;
    case 'base':
      return null;
    case 'working':
      return source.size;
    case 'repo':
      return (await svnFileSize(source.url)) ?? 0;
  }
}

/** Conteúdo de um lado. Symlink vira `link <alvo>`, como o svn guarda na BASE. */
async function read(source: Source): Promise<Buffer> {
  switch (source.from) {
    case 'none':
      return Buffer.alloc(0);
    case 'base':
      return runSvnRaw(['cat', '-r', 'BASE', localTarget(source.path)]);
    case 'working':
      return source.isLink
        ? Buffer.from(`link ${await readlink(source.path)}`)
        : readFile(source.path);
    case 'repo':
      return catRepo(source.url);
  }
}

/** Compara dois lados de um arquivo: binário, grande demais ou texto com o fim de linha de cada um. */
export async function compareSources(
  left: Source,
  right: Source,
  props: Promise<string | undefined>,
  force: boolean,
): Promise<DiffResponse> {
  // O arquivo de trabalho é sempre o lado direito quando aparece. Binário antes do tamanho:
  // um .jar grande não pede confirmação nem é lido inteiro.
  if (right.from === 'working' && !right.isLink && isBinary(await readHead(right.path))) {
    return { kind: 'binary', originalSize: null, modifiedSize: right.size, propsDiff: await props };
  }

  // Tamanho conferido antes de ler: arquivo grande do servidor pede confirmação sem trazer o
  // conteúdo pela rede.
  if (!force) {
    const [originalSize, modifiedSize] = await Promise.all([
      sizeBeforeReading(left),
      sizeBeforeReading(right),
    ]);
    if (Math.max(originalSize ?? 0, modifiedSize ?? 0) > MAX_DIFF_BYTES) {
      return { kind: 'too-large', originalSize, modifiedSize: modifiedSize ?? 0 };
    }
  }

  const [original, modified] = await Promise.all([read(left), read(right)]);

  if (isBinary(original) || isBinary(modified)) {
    return {
      kind: 'binary',
      originalSize: original.length,
      modifiedSize: modified.length,
      propsDiff: await props,
    };
  }
  if (!force && Math.max(original.length, modified.length) > MAX_DIFF_BYTES) {
    return { kind: 'too-large', originalSize: original.length, modifiedSize: modified.length };
  }

  const originalText = original.toString('utf8');
  const modifiedText = modified.toString('utf8');
  return {
    kind: 'text',
    original: originalText,
    modified: modifiedText,
    eol: { original: detectEol(originalText), modified: detectEol(modifiedText) },
    propsDiff: await props,
  };
}

/** Itens em que a versão BASE existe (arquivo já versionado antes da mudança). */
function hasBase(item: ItemStatus): boolean {
  return !['added', 'unversioned', 'none'].includes(item);
}

/** Itens em que o arquivo de trabalho existe no disco. */
function hasWorking(item: ItemStatus): boolean {
  return !['deleted', 'missing'].includes(item);
}

/**
 * Diff de um caminho do projeto. `revision` é a revisão do servidor usada pelos diffs que
 * envolvem o servidor (`incoming` e `local-head`).
 */
export async function fileDiff(
  project: Project,
  relativePath: string,
  compare: DiffCompare,
  revision: number | null,
  force: boolean,
): Promise<DiffResponse> {
  const absolute = resolveInProject(project, relativePath);
  const [left, right] = SIDES[compare];
  const url = revision === null ? null : projectPathUrl(project, relativePath, revision);
  if (compare !== 'local' && url === null) {
    throw new HttpError(400, 'falta a revisão do servidor para comparar');
  }

  const entry = (await svnStatus(absolute)).find((e) => e.path === absolute);
  const info = await lstat(absolute).catch(() => null);
  // Sem entrada no status e sem arquivo no disco: caminho que só existe no servidor.
  const item: ItemStatus = entry?.item ?? (info ? 'normal' : 'none');

  const props = noUnhandledRejection(
    compare === 'local'
      ? entry?.props === 'modified'
        ? propsDiff(absolute, [])
        : Promise.resolve(undefined)
      : hasBase(item)
        ? propsDiff(absolute, ['-r', compare === 'incoming' ? `BASE:${revision}` : `${revision}`])
        : Promise.resolve(undefined),
  );

  const isDirectory = info
    ? info.isDirectory()
    : url !== null && (await svnInfo(url)).kind === 'dir';
  if (isDirectory) return { kind: 'directory', item, propsDiff: await props };

  const source = (side: Side): Source => {
    switch (side) {
      case 'base':
        return hasBase(item) ? { from: 'base', path: absolute } : ABSENT;
      case 'working':
        return workingSource(absolute, hasWorking(item) ? info : null);
      case 'repo':
        return { from: 'repo', url: url! };
    }
  };
  return compareSources(source(left), source(right), props, force);
}
