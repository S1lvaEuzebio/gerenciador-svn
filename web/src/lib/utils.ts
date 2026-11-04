import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Leitura/escrita no localStorage que nunca quebra a página (janela anônima, armazenamento bloqueado). */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // preferência de conveniência; sem armazenamento, a página segue funcionando
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function projectCount(n: number): string {
  return `${n} ${n === 1 ? 'projeto' : 'projetos'}`;
}

export function firstLine(text: string): string {
  return text.split('\n', 1)[0] ?? '';
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Data do svn (ISO) no formato local; vazia quando o svn não informa. */
export function formatDate(iso: string): string {
  return iso ? dateFormat.format(new Date(iso)) : '';
}
