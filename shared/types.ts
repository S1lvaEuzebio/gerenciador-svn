import type {
  AppConfig,
  CommitRequest,
  DiffCompare,
  HistoryCompare,
  MergeChoice,
  ResolveAccept,
} from './schema.ts';

export type { CommitRequest, DiffCompare, HistoryCompare, MergeChoice, ResolveAccept };

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

/** Valores de `repos-status/@item` do `svn status -u --xml`. */
export type RemoteItem = 'added' | 'deleted' | 'modified' | 'replaced' | 'none';

/** Mudança que está no servidor e chega no próximo update. */
export interface IncomingChange {
  /** Relativo à working copy, com `/`. */
  path: string;
  kind: NodeKind;
  item: RemoteItem;
  /** Propriedades alteradas no servidor. */
  props: boolean;
  /** O caminho também tem mudança local (conteúdo ou propriedade): o update pode dar conflito. */
  localChange: boolean;
  ignored: boolean;
}

export interface ProjectRemoteStatus {
  projectId: string;
  /** Revisão do servidor usada na comparação (`against`). */
  headRevision: number | null;
  incoming: IncomingChange[];
  error?: string;
}

export interface RemoteStatusResponse {
  statuses: ProjectRemoteStatus[];
}

/** Ação do `svn log -v` num caminho: adicionado, apagado, modificado, substituído. */
export type ChangeAction = 'A' | 'D' | 'M' | 'R';

/** Caminho a partir da raiz do repositório (`/projeto/trunk/a.txt`) numa revisão. */
export interface RepoNode {
  path: string;
  revision: number;
}

/** Caminho relativo à working copy de um projeto descoberto. */
export interface ProjectFile {
  projectId: string;
  path: string;
}

/** Filtros do histórico: partes do autor e do texto da mensagem. */
export interface HistoryFilters {
  author: string;
  text: string;
}

export interface ChangedPath {
  /** Relativo à raiz do repositório, ex.: `/projeto/trunk/a.txt`. */
  path: string;
  action: ChangeAction;
  kind: NodeKind;
  /** Origem da cópia (cópia ou renomeação, inclusive de uma pasta acima). */
  copyFrom?: RepoNode;
  /** Propriedades alteradas; ausente quando o svn não informa. */
  propMods?: boolean;
  /** Projeto descoberto onde o caminho cai, com o caminho relativo a ele. */
  project?: ProjectFile;
}

export interface LogEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
  paths: ChangedPath[];
  /** Histórico de arquivo: a mudança do arquivo nesta revisão, no caminho que ele tinha então. */
  file?: ChangedPath;
}

/** Onde a próxima página do histórico começa: revisão e, no histórico de arquivo, o caminho nela. */
export interface LogCursor {
  before: number;
  path: string | null;
}

export interface LogPage {
  entries: LogEntry[];
  /** `null` quando chegou ao começo do histórico. */
  next: LogCursor | null;
  /** Menor revisão examinada; com filtro, nem toda revisão examinada entra na página. */
  scannedTo: number | null;
}

export type RevisionSummary = Pick<LogEntry, 'revision' | 'author' | 'date' | 'message'>;

export interface UpdatePreviewProject {
  projectId: string;
  /** Revisão atual da working copy. */
  fromRevision: number;
  headRevision: number | null;
  incoming: IncomingChange[];
  /** Revisões do servidor que mexem nos caminhos que vão chegar, da mais antiga à mais nova. */
  revisions: RevisionSummary[];
  /** A lista ficou só com as revisões mais recentes; as mais antigas foram cortadas. */
  revisionsTruncated: boolean;
  /** Comando exato do update; `null` quando não há nada para receber. */
  command: string | null;
  error?: string;
}

export interface UpdatePreview {
  projects: UpdatePreviewProject[];
}

/** `skipped`: não rodou porque uma etapa anterior da sequência falhou. */
export type StepState = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

export interface OperationStep {
  /** Projeto da etapa, ou o que ela faz quando mexe em vários (ex.: o commit). */
  label: string;
  command: string;
  state: StepState;
  /** Saída do svn até agora (stdout e stderr). */
  output: string;
}

/** Operação de gravação em andamento: uma etapa por working copy (update) ou em sequência (commit). */
export interface Operation {
  id: number;
  title: string;
  done: boolean;
  steps: OperationStep[];
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
  /** `originalSize` é `null` quando a base não chegou a ser lida. */
  | { kind: 'binary'; originalSize: number | null; modifiedSize: number; propsDiff?: string }
  | { kind: 'too-large'; originalSize: number | null; modifiedSize: number }
  | { kind: 'directory'; item: ItemStatus; propsDiff?: string };

/** Trecho do arquivo em conflito, lido dos marcadores que o svn grava. */
export type ConflictSegment =
  | { kind: 'text'; text: string }
  | {
      kind: 'conflict';
      mine: string;
      /** Versão da base; `null` quando o svn não gravou a seção `|||||||`. */
      base: string | null;
      theirs: string;
    };

export type ConflictHunk = Extract<ConflictSegment, { kind: 'conflict' }>;

export interface TextConflict {
  binary: boolean;
  /** Revisão da base antes do update e a que veio do servidor. */
  baseRevision: number | null;
  theirsRevision: number | null;
  sizes: { mine: number | null; base: number | null; theirs: number | null };
  /** Maior que 1 MB: comparação e editor só abrem depois de confirmar. */
  tooLarge: boolean;
  /** Versão local (`.mine`) e do servidor (`.rNEW`) para comparar; `null` se binário ou grande. */
  compare: { mine: string; theirs: string } | null;
  /** Dados do editor de mesclagem; `null` quando não dá para mesclar no app. */
  merge: { segments: ConflictSegment[]; fingerprint: string; eol: Eol } | null;
  /** Por que o editor não está disponível, quando `merge` é `null`. */
  mergeUnavailable?: string;
}

export interface TreeConflict {
  operation: string;
  /** O que veio do servidor (`edit`, `delete`, `add`, `replace`). */
  action: string;
  /** O que havia na cópia local (`edit`, `delete`, `missing`, `obstructed`, ...). */
  reason: string;
  kind: NodeKind;
  /** Comandos sugeridos para resolver no terminal (o app não resolve conflito de árvore). */
  commands: string[];
}

export interface ConflictDetails {
  path: string;
  text?: TextConflict;
  /** Conteúdo do arquivo `.prej` que o svn grava no conflito de propriedade. */
  property?: string;
  tree?: TreeConflict;
  /** Arquivos auxiliares que o svn criou; somem ao resolver. */
  auxFiles: string[];
  /** Opções de `svn resolve` que servem para este caminho, com o comando exato de cada uma. */
  accepts: Partial<Record<ResolveAccept, string>>;
  /** Comando que grava o resultado do editor de mesclagem. */
  mergeCommand: string | null;
}

/**
 * O que o commit faz com o caminho. `to-add` e `to-delete` são itens `?` e `!`: o app roda
 * `svn add` ou `svn delete` antes do commit. Os outros já estão marcados na working copy.
 */
export type CommitAction =
  'to-add' | 'to-delete' | 'added' | 'deleted' | 'modified' | 'replaced' | 'props';

export interface CommitItem {
  path: string;
  kind: NodeKind;
  action: CommitAction;
  /**
   * Entrou sem ser marcado: `parent` = pasta nova acima de um item marcado (o svn exige);
   * `content` = conteúdo de pasta nova ou apagada que foi marcada.
   */
  included?: 'parent' | 'content';
}

export interface CommitPreviewProject {
  projectId: string;
  items: CommitItem[];
  /** Itens marcados que mudaram no servidor: precisam de update antes do commit. */
  outdated: string[];
}

export interface CommitPreview {
  projects: CommitPreviewProject[];
  /** Comandos exatos, na ordem em que rodam. */
  commands: string[];
  /** Problemas que impedem o commit (item ignorado, em conflito, mensagem vazia...). */
  errors: string[];
  /** Identifica o plano: o commit só roda se o plano não mudou desde a prévia. */
  fingerprint: string;
}

export interface CommandResult {
  command: string;
  output: string;
}

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
