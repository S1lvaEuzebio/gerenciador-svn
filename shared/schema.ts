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

/**
 * Diff a mostrar: `local` = minhas mudanças (BASE × cópia local), `incoming` = o que vai chegar
 * (BASE × servidor), `local-head` = cópia local comparada com o servidor.
 */
export const diffCompareSchema = z.enum(['local', 'incoming', 'local-head']);

/** Opções de `svn resolve --accept` oferecidas na tela. */
export const resolveAcceptSchema = z.enum([
  'mine-conflict',
  'theirs-conflict',
  'mine-full',
  'theirs-full',
]);

/** Escolha para um trecho em conflito no editor de mesclagem. */
export const mergeChoiceSchema = z.union([
  z.object({ pick: z.enum(['mine', 'theirs', 'both']) }),
  z.object({ edit: z.string() }),
]);

export type AppConfig = z.infer<typeof configSchema>;
export type Group = z.infer<typeof groupSchema>;
export type IgnoreConfig = z.infer<typeof ignoreSchema>;
export type ReadOnlyConfig = z.infer<typeof readOnlySchema>;
export type DiffCompare = z.infer<typeof diffCompareSchema>;
export type ResolveAccept = z.infer<typeof resolveAcceptSchema>;
export type MergeChoice = z.infer<typeof mergeChoiceSchema>;
