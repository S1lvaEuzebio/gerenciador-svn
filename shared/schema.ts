import { z } from 'zod';

/** Padrões ignorados que já vêm configurados: arquivos de projeto do Eclipse. */
export const DEFAULT_IGNORE_PATTERNS = ['.classpath', '.project', '.settings/'];

export const DEFAULT_PORT = 4517;

export const groupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  /** Ids (caminhos absolutos) das working copies do grupo. */
  projects: z.array(z.string()),
});

export const ignoreSchema = z.object({
  global: z.array(z.string()),
  /** Padrões por projeto, indexados pelo id do projeto. */
  projects: z.record(z.string(), z.array(z.string())),
});

/** `true` = operação travada. */
export const readOnlySchema = z.object({
  local: z.boolean(),
  commit: z.boolean(),
});

/** `looseObject`: chaves desconhecidas (de versões futuras, por exemplo) são preservadas ao salvar. */
export const configSchema = z.looseObject({
  port: z.number().int().min(1024).max(65535).default(DEFAULT_PORT),
  roots: z.array(z.string()).default([]),
  groups: z.array(groupSchema).default([]),
  ignore: ignoreSchema.default({ global: DEFAULT_IGNORE_PATTERNS, projects: {} }),
  readOnly: readOnlySchema.default({ local: true, commit: true }),
});

export type AppConfig = z.infer<typeof configSchema>;
export type Group = z.infer<typeof groupSchema>;
export type IgnoreConfig = z.infer<typeof ignoreSchema>;
export type ReadOnlyConfig = z.infer<typeof readOnlySchema>;
