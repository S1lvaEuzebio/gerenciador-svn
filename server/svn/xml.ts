import { XMLParser } from 'fast-xml-parser';

const ARRAY_TAGS = new Set(['entry', 'target']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name, _jPath, _isLeafNode, isAttribute) => !isAttribute && ARRAY_TAGS.has(name),
});

/** Converte a saída `--xml` do svn em objeto; tags repetíveis viram sempre array. */
export function parseSvnXml<T>(xml: string): T {
  return parser.parse(xml) as T;
}
