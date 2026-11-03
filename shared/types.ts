import type { AppConfig } from './schema.ts';

/** Valores de `wc-status/@item` do `svn status --xml`. */
export type ItemStatus =
  | 'added'
  | 'conflicted'
  | 'deleted'
  | 'external'
  | 'ignored'
  | 'incomplete'
  | 'missing'
  | 'modified'
  | 'none'
  | 'normal'
  | 'obstructed'
  | 'replaced'
  | 'unversioned';

/** Valores de `wc-status/@props`. */
export type PropStatus = 'conflicted' | 'modified' | 'none' | 'normal';

export type NodeKind = 'dir' | 'file' | 'unknown';

export interface Project {
  /** Caminho absoluto da working copy. */
  id: string;
  /** Nome da pasta. */
  name: string;
  /** Raiz configurada onde o projeto foi encontrado. */
  root: string;
  repoRootUrl: string;
  /** Caminho no repositório, ex.: `^/projeto/trunk`. */
  relativeUrl: string;
  revision: number;
}

export interface RootError {
  root: string;
  message: string;
}

export interface ProjectsResponse {
  projects: Project[];
  errors: RootError[];
}

export interface LocalChange {
  /** Relativo à working copy, com `/`. Vazio para a própria pasta raiz do projeto. */
  path: string;
  kind: NodeKind;
  item: ItemStatus;
  props: PropStatus;
  treeConflict: boolean;
  /** Casou com algum padrão de ignorados. */
  ignored: boolean;
}

export interface ProjectStatus {
  projectId: string;
  changes: LocalChange[];
  error?: string;
}

export interface StatusResponse {
  statuses: ProjectStatus[];
}

export type Eol = 'crlf' | 'lf' | 'mixed' | 'none';

export type DiffResponse =
  | {
      kind: 'text';
      original: string;
      modified: string;
      eol: { original: Eol; modified: Eol };
      propsDiff?: string;
    }
  | { kind: 'binary'; originalSize: number; modifiedSize: number; propsDiff?: string }
  | { kind: 'too-large'; originalSize: number; modifiedSize: number }
  | { kind: 'directory'; item: ItemStatus; propsDiff?: string };

export interface ConsoleEntry {
  id: number;
  startedAt: string;
  durationMs: number | null;
  /** Comando como seria digitado no terminal. */
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ConfigResponse {
  config: AppConfig;
  configPath: string;
}

export interface ApiError {
  error: string;
}
