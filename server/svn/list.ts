import { isNotFound, runSvn } from './run.ts';
import { parseSvnXml } from './xml.ts';

interface ListXml {
  lists?: { list?: { entry?: Array<{ size?: string }> } };
}

/**
 * Tamanho de um arquivo no repositório (`svn list --xml url@rev`), sem baixar o conteúdo.
 * `null` quando o caminho não existe nessa revisão.
 */
export async function svnFileSize(url: string): Promise<number | null> {
  try {
    const xml = await runSvn(['list', '--xml', url]);
    const size = parseSvnXml<ListXml>(xml).lists?.list?.entry?.[0]?.size;
    return size === undefined ? null : Number(size);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
