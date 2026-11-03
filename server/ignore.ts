import picomatch from 'picomatch';
import type { AppConfig } from '../shared/schema.ts';

/**
 * Converte um padrão no estilo `.gitignore` em globs relativos à raiz do projeto:
 * - sem `/` (ex.: `.classpath`) casa em qualquer profundidade;
 * - com `/` no meio ou no início (ex.: `build/classes/`) é ancorado na raiz;
 * - casar uma pasta inclui tudo que está dentro dela.
 */
function toGlobs(pattern: string): string[] {
  let p = pattern.trim().replace(/\\/g, '/');
  if (p === '' || p.startsWith('#')) return [];
  const leadingSlash = p.startsWith('/');
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p === '') return [];
  const base = leadingSlash || p.includes('/') ? p : `**/${p}`;
  return [base, `${base}/**`];
}

export type IgnoreMatcher = (relativePath: string) => boolean;

export function compileIgnore(patterns: string[]): IgnoreMatcher {
  const globs = patterns.flatMap(toGlobs);
  if (globs.length === 0) return () => false;
  const isMatch = picomatch(globs, { dot: true });
  return (relativePath) => relativePath !== '' && isMatch(relativePath);
}

export function projectIgnoreMatcher(config: AppConfig, projectId: string): IgnoreMatcher {
  return compileIgnore([...config.ignore.global, ...(config.ignore.projects[projectId] ?? [])]);
}
