import type { ConsoleEntry } from '../shared/types.ts';

const MAX_ENTRIES = 300;
const MAX_OUTPUT_CHARS = 20_000;

let nextId = 1;
const entries: ConsoleEntry[] = [];

function quoteArg(arg: string): string {
  return /^[\w@%+=:,./^-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (saída cortada, ${text.length} caracteres)`
    : text;
}

export function formatCommand(args: string[]): string {
  return ['svn', ...args].map(quoteArg).join(' ');
}

/** Registra o início de um comando svn e devolve a entrada para ser completada depois. */
export function startEntry(args: string[]): ConsoleEntry {
  const entry: ConsoleEntry = {
    id: nextId++,
    startedAt: new Date().toISOString(),
    durationMs: null,
    command: formatCommand(args),
    exitCode: null,
    stdout: '',
    stderr: '',
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  return entry;
}

export function finishEntry(
  entry: ConsoleEntry,
  result: { exitCode: number | null; stdout: string; stderr: string },
): void {
  entry.durationMs = Date.now() - Date.parse(entry.startedAt);
  entry.exitCode = result.exitCode;
  entry.stdout = truncate(result.stdout);
  entry.stderr = truncate(result.stderr);
}

export function listEntries(): ConsoleEntry[] {
  return entries;
}

export function clearEntries(): void {
  entries.length = 0;
}
