import type { ItemStatus, PropStatus } from '../../shared/types.ts';
import { runSvn } from './run.ts';
import { parseSvnXml } from './xml.ts';

interface StatusXml {
  status?: {
    target?: Array<{
      entry?: Array<{
        path: string;
        'wc-status'?: { item?: string; props?: string; 'tree-conflicted'?: string };
      }>;
    }>;
  };
}

export interface StatusEntry {
  /** Caminho absoluto, como o svn devolve para alvos absolutos. */
  path: string;
  item: ItemStatus;
  props: PropStatus;
  treeConflict: boolean;
}

/** `svn status --xml` local (sem consultar o servidor). */
export async function svnStatus(target: string): Promise<StatusEntry[]> {
  const xml = await runSvn(['status', '--xml', target]);
  const targets = parseSvnXml<StatusXml>(xml).status?.target ?? [];
  return targets.flatMap((t) =>
    (t.entry ?? []).map((e) => ({
      path: e.path,
      item: (e['wc-status']?.item ?? 'none') as ItemStatus,
      props: (e['wc-status']?.props ?? 'none') as PropStatus,
      treeConflict: e['wc-status']?.['tree-conflicted'] === 'true',
    })),
  );
}
