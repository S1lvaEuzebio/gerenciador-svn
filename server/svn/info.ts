import type { NodeKind } from '../../shared/types.ts';
import { runSvn } from './run.ts';
import { parseSvnXml } from './xml.ts';

interface ConflictXml {
  type?: string;
  version?: Array<{ side?: string; revision?: string }> | { side?: string; revision?: string };
  'prev-base-file'?: string;
  'prev-wc-file'?: string;
  'cur-base-file'?: string;
  'prop-file'?: string;
}

interface InfoXml {
  info?: {
    entry?: Array<{
      kind?: string;
      revision?: string;
      'relative-url'?: string;
      repository?: { root?: string };
      conflict?: ConflictXml[];
      'tree-conflict'?: {
        operation?: string;
        action?: string;
        reason?: string;
        kind?: string;
      };
    }>;
  };
}

export interface WcInfo {
  kind: NodeKind;
  relativeUrl: string;
  repoRootUrl: string;
  revision: number;
}

/** Arquivos que o svn gravou no conflito, como aparecem no `svn info --xml`. */
export interface ConflictFiles {
  type: 'text' | 'property';
  baseRevision: number | null;
  theirsRevision: number | null;
  /** `.rOLD`: base antes do update. */
  base?: string;
  /** `.mine`: versão local antes do update (ausente em binário: o próprio arquivo é a local). */
  mine?: string;
  /** `.rNEW`: versão que veio do servidor. */
  theirs?: string;
  /** `.prej`: descrição do conflito de propriedade. */
  prej?: string;
}

export interface ConflictInfo {
  conflicts: ConflictFiles[];
  tree?: { operation: string; action: string; reason: string; kind: string };
}

function decodeUrlPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function infoEntry(path: string) {
  const xml = await runSvn(['info', '--xml', path]);
  const entry = parseSvnXml<InfoXml>(xml).info?.entry?.[0];
  if (!entry) throw new Error(`svn info sem resultado para ${path}`);
  return entry;
}

/** `path` pode ser um caminho da working copy ou uma URL com revisão (`url@123`). */
export async function svnInfo(path: string): Promise<WcInfo> {
  const entry = await infoEntry(path);
  return {
    kind: entry.kind === 'dir' || entry.kind === 'file' ? entry.kind : 'unknown',
    relativeUrl: decodeUrlPath(entry['relative-url'] ?? ''),
    repoRootUrl: entry.repository?.root ?? '',
    revision: Number(entry.revision ?? 0),
  };
}

function revisionOf(conflict: ConflictXml, side: string): number | null {
  const versions = Array.isArray(conflict.version) ? conflict.version : [conflict.version ?? {}];
  const revision = versions.find((v) => v.side === side)?.revision;
  return revision === undefined ? null : Number(revision);
}

/** Detalhes de conflito de um caminho da working copy. */
export async function svnConflictInfo(path: string): Promise<ConflictInfo> {
  const entry = await infoEntry(path);
  const tree = entry['tree-conflict'];
  return {
    conflicts: (entry.conflict ?? []).map((c) => ({
      type: c.type === 'property' ? 'property' : 'text',
      baseRevision: revisionOf(c, 'source-left'),
      theirsRevision: revisionOf(c, 'source-right'),
      base: c['prev-base-file'],
      mine: c['prev-wc-file'],
      theirs: c['cur-base-file'],
      prej: c['prop-file'],
    })),
    tree: tree && {
      operation: tree.operation ?? '',
      action: tree.action ?? '',
      reason: tree.reason ?? '',
      kind: tree.kind ?? '',
    },
  };
}
