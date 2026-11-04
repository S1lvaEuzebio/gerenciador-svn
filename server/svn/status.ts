import type { ItemStatus, PropStatus, RemoteItem } from '../../shared/types.ts';
import { runSvn } from './run.ts';
import { parseSvnXml } from './xml.ts';

interface EntryXml {
  path: string;
  'wc-status'?: { item?: string; props?: string; 'tree-conflicted'?: string };
  'repos-status'?: { item?: string; props?: string };
}

interface StatusXml {
  status?: {
    target?: Array<{ entry?: EntryXml[]; against?: { revision?: string } }>;
  };
}

export interface StatusEntry {
  /** Caminho absoluto, como o svn devolve para alvos absolutos. */
  path: string;
  item: ItemStatus;
  props: PropStatus;
  treeConflict: boolean;
}

export interface RemoteStatusEntry extends StatusEntry {
  /** O que mudou no servidor; `null` quando nada vai chegar para este caminho. */
  remote: { item: RemoteItem; props: boolean } | null;
}

export interface RemoteStatus {
  /** Revisão do servidor usada na comparação. */
  against: number | null;
  entries: RemoteStatusEntry[];
}

function toEntry(e: EntryXml): StatusEntry {
  return {
    path: e.path,
    item: (e['wc-status']?.item ?? 'none') as ItemStatus,
    props: (e['wc-status']?.props ?? 'none') as PropStatus,
    treeConflict: e['wc-status']?.['tree-conflicted'] === 'true',
  };
}

function toRemote(e: EntryXml): RemoteStatusEntry['remote'] {
  const repos = e['repos-status'];
  if (!repos) return null;
  const item = (repos.item ?? 'none') as RemoteItem;
  const props = repos.props === 'modified';
  return item === 'none' && !props ? null : { item, props };
}

/** `svn status --xml` local (sem consultar o servidor). */
export async function svnStatus(target: string): Promise<StatusEntry[]> {
  const xml = await runSvn(['status', '--xml', target]);
  const targets = parseSvnXml<StatusXml>(xml).status?.target ?? [];
  return targets.flatMap((t) => (t.entry ?? []).map(toEntry));
}

/** `svn status -u --xml`: consulta o servidor e marca o que chega no próximo update. */
export async function svnRemoteStatus(target: string): Promise<RemoteStatus> {
  const xml = await runSvn(['status', '-u', '--xml', target]);
  const [first] = parseSvnXml<StatusXml>(xml).status?.target ?? [];
  const against = first?.against?.revision;
  return {
    against: against === undefined ? null : Number(against),
    entries: (first?.entry ?? []).map((e) => ({ ...toEntry(e), remote: toRemote(e) })),
  };
}
