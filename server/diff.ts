import { lstat, open, readFile, readlink } from 'node:fs/promises';
import type { DiffCompare, DiffResponse, Eol, ItemStatus, Project } from '../shared/types.ts';
import { HttpError } from './http-error.ts';
import { repoUrl, resolveInProject } from './projects.ts';
import { svnInfo } from './svn/info.ts';
import { svnFileSize } from './svn/list.ts';
import { localTarget, runSvn, runSvnRaw, SvnError } from './svn/run.ts';
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

/** Conteúdo do arquivo de trabalho. Symlink vira `link <alvo>`, como o svn guarda na BASE. */
async function readWorking(path: string, isLink: boolean): Promise<Buffer> {
  return isLink ? Buffer.from(`link ${await readlink(path)}`) : readFile(path);
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

/** Caminho que não existe na revisão pedida do servidor (ex.: apagado lá). */
function isNotFound(error: unknown): boolean {
  return error instanceof SvnError && /W160013|E160013/.test(error.message);
}

async function propsDiff(path: string, revisionArgs: string[]): Promise<string | undefined> {
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
  const url = revision === null ? null : repoUrl(project, relativePath, revision);
  if (compare !== 'local' && url === null) {
    throw new HttpError(400, 'falta a revisão do servidor para comparar');
  }

  const entry = (await svnStatus(absolute)).find((e) => e.path === absolute);
  const info = await lstat(absolute).catch(() => null);
  // Sem entrada no status e sem arquivo no disco: caminho que só existe no servidor.
  const item: ItemStatus = entry?.item ?? (info ? 'normal' : 'none');

  const props =
    compare === 'local'
      ? entry?.props === 'modified'
        ? propsDiff(absolute, [])
        : Promise.resolve(undefined)
      : hasBase(item)
        ? propsDiff(absolute, ['-r', compare === 'incoming' ? `BASE:${revision}` : `${revision}`])
        : Promise.resolve(undefined);
  // Nem todo retorno abaixo espera o diff de propriedades; sem isto, uma falha dele derrubaria
  // o processo como rejeição não tratada. Quem faz `await props` continua recebendo o erro.
  props.catch(() => undefined);

  const isDirectory = info
    ? info.isDirectory()
    : url !== null && (await svnInfo(url)).kind === 'dir';
  if (isDirectory) return { kind: 'directory', item, propsDiff: await props };

  const working = hasWorking(item) ? info : null;
  const isLink = working?.isSymbolicLink() ?? false;
  const workingSize = working?.size ?? 0;

  // O arquivo de trabalho é sempre o lado direito quando aparece. Binário antes do tamanho:
  // um .jar grande não pede confirmação nem é lido inteiro.
  if (right === 'working') {
    if (working && !isLink && isBinary(await readHead(absolute))) {
      return {
        kind: 'binary',
        originalSize: null,
        modifiedSize: workingSize,
        propsDiff: await props,
      };
    }
    if (!force && workingSize > MAX_DIFF_BYTES) {
      return { kind: 'too-large', originalSize: null, modifiedSize: workingSize };
    }
  }

  // O lado do servidor tem o tamanho conferido antes de baixar: arquivo grande pede confirmação
  // sem trazer o conteúdo pela rede.
  if (!force && (left === 'repo' || right === 'repo')) {
    const repoSize = (await svnFileSize(url!)) ?? 0;
    if (repoSize > MAX_DIFF_BYTES) {
      return left === 'repo'
        ? { kind: 'too-large', originalSize: repoSize, modifiedSize: workingSize }
        : { kind: 'too-large', originalSize: null, modifiedSize: repoSize };
    }
  }

  const read = (side: Side): Promise<Buffer> => {
    switch (side) {
      case 'base':
        return hasBase(item)
          ? runSvnRaw(['cat', '-r', 'BASE', localTarget(absolute)])
          : Promise.resolve(Buffer.alloc(0));
      case 'repo':
        return catRepo(url!);
      case 'working':
        return working ? readWorking(absolute, isLink) : Promise.resolve(Buffer.alloc(0));
    }
  };
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
