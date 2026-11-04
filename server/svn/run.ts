import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { finishEntry, formatCommand, startEntry } from '../console-log.ts';

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

/** Argumentos completos: `--non-interactive` logo depois do subcomando. */
function svnArgs(args: string[]): string[] {
  const [subcommand, ...rest] = args;
  if (!subcommand) throw new Error('subcomando svn ausente');
  return [subcommand, '--non-interactive', ...rest];
}

/** Comando exato que `runSvnRaw(args)` executa, para mostrar na confirmação. */
export function svnCommandLine(args: string[]): string {
  return formatCommand(svnArgs(args));
}

/**
 * Executa `svn <subcomando> --non-interactive ...` sem shell, com os argumentos em lista.
 * Rejeita com `SvnError` se o svn sair com código diferente de zero.
 * `onOutput` recebe stdout e stderr à medida que chegam (saída ao vivo).
 */
export function runSvnRaw(args: string[], onOutput?: (text: string) => void): Promise<Buffer> {
  const fullArgs = svnArgs(args);
  const entry = startEntry(fullArgs);
  const stdoutText = new StringDecoder('utf8');
  const stderrText = new StringDecoder('utf8');

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
      onOutput?.(stdoutText.write(chunk));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      onOutput?.(stderrText.write(chunk));
    });

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
