import type { ChangeAction, ChangedPath, LogEntry } from '../../shared/types.ts';
import { runSvn } from './run.ts';
import { parseSvnXml, toNodeKind } from './xml.ts';

interface PathXml {
  '#text'?: string;
  action?: string;
  kind?: string;
  'copyfrom-path'?: string;
  'copyfrom-rev'?: string;
  'prop-mods'?: string;
}

interface LogXml {
  log?: {
    logentry?: Array<{
      revision: string;
      author?: string;
      date?: string;
      msg?: string;
      paths?: { path?: Array<PathXml | string> };
    }>;
  };
}

const isAction = (value: string | undefined): value is ChangeAction =>
  value === 'A' || value === 'D' || value === 'M' || value === 'R';

function changedPath(xml: PathXml | string): ChangedPath {
  if (typeof xml === 'string') return { path: xml, action: 'M', kind: 'unknown' };
  const from = xml['copyfrom-path'];
  return {
    path: xml['#text'] ?? '',
    action: isAction(xml.action) ? xml.action : 'M',
    kind: toNodeKind(xml.kind),
    ...(from !== undefined && {
      copyFrom: { path: from, revision: Number(xml['copyfrom-rev']) },
    }),
    ...(xml['prop-mods'] !== undefined && { propMods: xml['prop-mods'] === 'true' }),
  };
}

/**
 * `svn log -v --xml` num intervalo de revisões (`inicio:fim`). `targets` é uma URL ou uma URL
 * seguida de caminhos relativos a ela: o log unificado desses caminhos. `quiet` deixa a
 * mensagem de fora.
 */
export async function svnLog(
  targets: string[],
  range: string,
  limit: number,
  quiet = false,
): Promise<LogEntry[]> {
  const xml = await runSvn([
    'log',
    '--xml',
    '-v',
    ...(quiet ? ['-q'] : []),
    '-l',
    String(limit),
    '-r',
    range,
    ...targets,
  ]);
  return (parseSvnXml<LogXml>(xml).log?.logentry ?? []).map((e) => ({
    revision: Number(e.revision),
    author: e.author ?? '',
    date: e.date ?? '',
    message: e.msg ?? '',
    paths: (e.paths?.path ?? []).map(changedPath),
  }));
}
