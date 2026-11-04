import { spawn } from 'node:child_process';
import { finishEntry, startEntry } from '../console-log.ts';

/** Saída máxima aceita antes de matar o processo. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export class SvnError extends Error {
  readonly exitCode: number | null;

  constructor(message: string, exitCode: number | null) {
    super(message);
    this.name = 'SvnError';
    this.exitCode = exitCode;
  }
}

/**
 * Executa `svn <subcomando> --non-interactive ...` sem shell, com os argumentos em lista.
 * Rejeita com `SvnError` se o svn sair com código diferente de zero.
 */
export function runSvnRaw(args: string[]): Promise<Buffer> {
  const [subcommand, ...rest] = args;
  if (!subcommand) throw new Error('subcomando svn ausente');
  const fullArgs = [subcommand, '--non-interactive', ...rest];
  const entry = startEntry(fullArgs);

  return new Promise((resolve, reject) => {
    const child = spawn('svn', fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let overflow = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', (error: NodeJS.ErrnoException) => {
      const message =
        error.code === 'ENOENT'
          ? 'svn não encontrado no PATH'
          : `falha ao executar svn: ${error.message}`;
      finishEntry(entry, { exitCode: null, stdout: '', stderr: message });
      reject(new SvnError(message, null));
    });

    child.on('close', (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr).toString('utf8');
      finishEntry(entry, { exitCode: code, stdout: out.toString('utf8'), stderr: err });
      if (overflow) {
        reject(new SvnError(`saída do svn passou de ${MAX_OUTPUT_BYTES} bytes`, code));
      } else if (code !== 0) {
        reject(new SvnError(err.trim() || `svn saiu com código ${code}`, code));
      } else {
        resolve(out);
      }
    });
  });
}

export async function runSvn(args: string[]): Promise<string> {
  return (await runSvnRaw(args)).toString('utf8');
}
