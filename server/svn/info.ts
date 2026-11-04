import type { NodeKind, TreeConflict } from '../../shared/types.ts';
import { localTarget, runSvn } from './run.ts';
import { parseSvnXml, toNodeKind } from './xml.ts';

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
      path?: string;
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

/** Dados de um nó, da working copy ou do repositório. */
export interface NodeInfo {
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
  tree?: Omit<TreeConflict, 'commands'>;
}

function decodeUrlPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function infoEntry(path: string) {
  const xml = await runSvn(['info', '--xml', localTarget(path)]);
  const entry = parseSvnXml<InfoXml>(xml).info?.entry?.[0];
  if (!entry) throw new Error(`svn info sem resultado para ${path}`);
  return entry;
}

/** `path` pode ser um caminho da working copy ou uma URL com revisão (`url@123`). */
export async function svnInfo(path: string): Promise<NodeInfo> {
  const entry = await infoEntry(path);
  return {
    kind: toNodeKind(entry.kind),
    relativeUrl: decodeUrlPath(entry['relative-url'] ?? ''),
    repoRootUrl: entry.repository?.root ?? '',
    revision: Number(entry.revision ?? 0),
  };
}

/** Todos os nós versionados dentro de um caminho (inclusive apagados), com o próprio caminho. */
export async function svnTree(path: string): Promise<Array<{ path: string; kind: NodeKind }>> {
  const xml = await runSvn(['info', '--depth', 'infinity', '--xml', localTarget(path)]);
  return (parseSvnXml<InfoXml>(xml).info?.entry ?? []).map((e) => ({
    path: e.path ?? '',
    kind: toNodeKind(e.kind),
  }));
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
      kind: toNodeKind(tree.kind),
    },
  };
}
