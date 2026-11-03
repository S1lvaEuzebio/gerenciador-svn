import { readFile, stat } from 'node:fs/promises';
import type { DiffResponse, Eol, ItemStatus, Project } from '../shared/types.ts';
import { resolveInProject } from './projects.ts';
import { runSvn, runSvnRaw } from './svn/run.ts';
import { svnStatus } from './svn/status.ts';

export const MAX_DIFF_BYTES = 1024 * 1024;

/** Mesma heurística do git: byte nulo nos primeiros 8000 bytes indica binário. */
function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
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

  const info = await stat(absolute).catch(() => null);
  if (info?.isDirectory()) return { kind: 'directory', item, propsDiff: props };

  const workingSize = hasWorking(item) && info ? info.size : 0;
  if (!force && workingSize > MAX_DIFF_BYTES) {
    return { kind: 'too-large', originalSize: 0, modifiedSize: workingSize };
  }

  const original = hasBase(item)
    ? await runSvnRaw(['cat', '-r', 'BASE', absolute])
    : Buffer.alloc(0);
  const modified = hasWorking(item) && info ? await readFile(absolute) : Buffer.alloc(0);

  if (!force && original.length > MAX_DIFF_BYTES) {
    return { kind: 'too-large', originalSize: original.length, modifiedSize: modified.length };
  }
  if (isBinary(original) || isBinary(modified)) {
    return {
      kind: 'binary',
      originalSize: original.length,
      modifiedSize: modified.length,
      propsDiff: props,
    };
  }

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
