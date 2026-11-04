import { runSvn } from './run.ts';
import { parseSvnXml } from './xml.ts';

interface LogXml {
  log?: {
    logentry?: Array<{
      revision: string;
      author?: string;
      date?: string;
      msg?: string;
      paths?: { path?: Array<{ '#text'?: string } | string> };
    }>;
  };
}

export interface LogEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
  /** Caminhos alterados, relativos à raiz do repositório (ex.: `/projeto/trunk/a.txt`). */
  paths: string[];
}

/** `svn log -v --xml` de um alvo num intervalo de revisões (`inicio:fim`). */
export async function svnLog(target: string, range: string, limit: number): Promise<LogEntry[]> {
  const xml = await runSvn(['log', '--xml', '-v', '-l', String(limit), '-r', range, target]);
  return (parseSvnXml<LogXml>(xml).log?.logentry ?? []).map((e) => ({
    revision: Number(e.revision),
    author: e.author ?? '',
    date: e.date ?? '',
    message: e.msg ?? '',
    paths: (e.paths?.path ?? []).map((p) => (typeof p === 'string' ? p : (p['#text'] ?? ''))),
  }));
}
