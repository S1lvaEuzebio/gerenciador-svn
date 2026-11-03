import { runSvn } from './run.ts';
import { parseSvnXml } from './xml.ts';

interface InfoXml {
  info?: {
    entry?: Array<{
      revision?: string;
      url?: string;
      'relative-url'?: string;
      repository?: { root?: string; uuid?: string };
    }>;
  };
}

export interface WcInfo {
  url: string;
  relativeUrl: string;
  repoRootUrl: string;
  repoUuid: string;
  revision: number;
}

function decodeUrlPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function svnInfo(path: string): Promise<WcInfo> {
  const xml = await runSvn(['info', '--xml', path]);
  const entry = parseSvnXml<InfoXml>(xml).info?.entry?.[0];
  if (!entry) throw new Error(`svn info sem resultado para ${path}`);
  return {
    url: entry.url ?? '',
    relativeUrl: decodeUrlPath(entry['relative-url'] ?? ''),
    repoRootUrl: entry.repository?.root ?? '',
    repoUuid: entry.repository?.uuid ?? '',
    revision: Number(entry.revision ?? 0),
  };
}
