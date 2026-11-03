import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { configSchema, type AppConfig } from '../shared/schema.ts';

export const configPath =
  process.env.GERENCIADOR_SVN_CONFIG ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'gerenciador-svn', 'config.json');

let current: AppConfig | undefined;

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/** Normaliza uma lista de padrões: tira espaços, linhas vazias e comentários. */
export function cleanPatterns(patterns: string[]): string[] {
  return patterns.map((p) => p.trim()).filter((p) => p !== '' && !p.startsWith('#'));
}

async function save(config: AppConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(tmp, configPath);
}

/** Lê a configuração do disco; na primeira execução grava os valores padrão. */
export async function loadConfig(): Promise<AppConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`não foi possível ler ${configPath}: ${(error as Error).message}`, {
        cause: error,
      });
    }
    raw = {};
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`configuração inválida em ${configPath}: ${parsed.error.message}`);
  }
  current = parsed.data;
  await save(current);
  return current;
}

export function getConfig(): AppConfig {
  if (!current) throw new Error('configuração ainda não carregada');
  return current;
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = configSchema.parse({ ...getConfig(), ...patch });
  await save(next);
  current = next;
  return next;
}

/** Raízes com `~` expandido e caminho absoluto. */
export function resolvedRoots(config: AppConfig = getConfig()): string[] {
  return config.roots.map((root) => resolve(expandHome(root)));
}
