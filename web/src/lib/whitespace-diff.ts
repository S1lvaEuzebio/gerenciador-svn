import { Change, diff } from '@codemirror/merge';

const FIRST_TOKEN = 0x100;
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;
const LAST_TOKEN = 0xfffd;

function lineStarts(lines: string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

/**
 * Diff por linha que ignora qualquer diferença de espaço em branco (como `svn diff -x -w`).
 * Cada linha normalizada vira um caractere, o diff roda sobre essas "letras" e o resultado
 * é convertido de volta para posições do texto original.
 */
export function whitespaceInsensitiveDiff(a: string, b: string): readonly Change[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const tokens = new Map<string, string>();
  let next = FIRST_TOKEN;

  const encode = (lines: string[]): string | null => {
    let out = '';
    for (const line of lines) {
      const key = line.replace(/\s+/g, '');
      let token = tokens.get(key);
      if (token === undefined) {
        if (next === SURROGATE_START) next = SURROGATE_END + 1;
        if (next > LAST_TOKEN) return null;
        token = String.fromCharCode(next++);
        tokens.set(key, token);
      }
      out += token;
    }
    return out;
  };

  const encodedA = encode(linesA);
  const encodedB = encode(linesB);
  if (encodedA === null || encodedB === null) return diff(a, b);

  const startsA = lineStarts(linesA);
  const startsB = lineStarts(linesB);
  const offsetA = (line: number) => (line >= linesA.length ? a.length : startsA[line]!);
  const offsetB = (line: number) => (line >= linesB.length ? b.length : startsB[line]!);

  return diff(encodedA, encodedB).map(
    (c) => new Change(offsetA(c.fromA), offsetA(c.toA), offsetB(c.fromB), offsetB(c.toB)),
  );
}
