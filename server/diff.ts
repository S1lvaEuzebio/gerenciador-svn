import { lstat, open, readFile, readlink } from 'node:fs/promises';
import type { DiffResponse, Eol, ItemStatus, Project } from '../shared/types.ts';
import { resolveInProject } from './projects.ts';
import { runSvn, runSvnRaw } from './svn/run.ts';
import { svnStatus } from './svn/status.ts';

export const MAX_DIFF_BYTES = 1024 * 1024;

const BINARY_SNIFF_BYTES = 8000;

/** Mesma heurística do git: byte nulo nos primeiros 8000 bytes indica binário. */
function isBinary(buffer: Buffer): boolean {
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

function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf > 0) return 'mixed';
  return crlf > 0 ? 'crlf' : 'lf';
}

async function propsDiff(path: string): Promise<string | undefined> {
  const text = await runSvn(['diff', '--depth', 'empty', '--properties-only', path]);
  return text.trim() === '' ? undefined : text;
}

/** Itens em que a versão BASE existe (arquivo já versionado antes da mudança). */
function hasBase(item: ItemStatus): boolean {
  return !['added', 'unversioned', 'none'].includes(item);
}

/** Itens em que o arquivo de trabalho existe no disco. */
function hasWorking(item: ItemStatus): boolean {
  return !['deleted', 'missing'].includes(item);
}

/** Diff "minhas mudanças": cópia local × BASE. */
export async function localDiff(
  project: Project,
  relativePath: string,
  force: boolean,
): Promise<DiffResponse> {
  const absolute = resolveInProject(project, relativePath);
  const entry = (await svnStatus(absolute)).find((e) => e.path === absolute);
  const item: ItemStatus = entry?.item ?? 'normal';
  const props = entry?.props === 'modified' ? await propsDiff(absolute) : undefined;

  const info = await lstat(absolute).catch(() => null);
  if (info?.isDirectory()) return { kind: 'directory', item, propsDiff: props };

  const working = hasWorking(item) ? info : null;
  const isLink = working?.isSymbolicLink() ?? false;
  const workingSize = working?.size ?? 0;

  // Binário antes do tamanho: um .jar grande não pede confirmação nem é lido inteiro.
  if (working && !isLink && isBinary(await readHead(absolute))) {
    return { kind: 'binary', originalSize: null, modifiedSize: workingSize, propsDiff: props };
  }
  if (!force && workingSize > MAX_DIFF_BYTES) {
    return { kind: 'too-large', originalSize: null, modifiedSize: workingSize };
  }

  const original = hasBase(item)
    ? await runSvnRaw(['cat', '-r', 'BASE', absolute])
    : Buffer.alloc(0);
  if (isBinary(original)) {
    return {
      kind: 'binary',
      originalSize: original.length,
      modifiedSize: workingSize,
      propsDiff: props,
    };
  }
  if (!force && original.length > MAX_DIFF_BYTES) {
    return { kind: 'too-large', originalSize: original.length, modifiedSize: workingSize };
  }

  const modified = working ? await readWorking(absolute, isLink) : Buffer.alloc(0);
  const originalText = original.toString('utf8');
  const modifiedText = modified.toString('utf8');
  return {
    kind: 'text',
    original: originalText,
    modified: modifiedText,
    eol: { original: detectEol(originalText), modified: detectEol(modifiedText) },
    propsDiff: props,
  };
}
