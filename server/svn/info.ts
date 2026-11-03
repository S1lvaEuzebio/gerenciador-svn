import { runSvn } from './run.ts';
import { parseSvnXml } from './xml.ts';

interface InfoXml {
  info?: {
    entry?: Array<{
      revision?: string;
      'relative-url'?: string;
      repository?: { root?: string };
    }>;
  };
}

export interface WcInfo {
  relativeUrl: string;
  repoRootUrl: string;
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
    relativeUrl: decodeUrlPath(entry['relative-url'] ?? ''),
    repoRootUrl: entry.repository?.root ?? '',
    revision: Number(entry.revision ?? 0),
  };
}
