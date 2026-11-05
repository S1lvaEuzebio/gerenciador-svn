import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import {
  commitReferenceSchema,
  commitRequestSchema,
  diffCompareSchema,
  groupSchema,
  historyCompareSchema,
  ignoreSchema,
  mergeChoiceSchema,
  readOnlySchema,
  resolveAcceptSchema,
  revertRequestSchema,
} from '../shared/schema.ts';
import type {
  CleanupPreview,
  CommandResult,
  CommitPreview,
  ConfigResponse,
  ConflictDetails,
  ConsoleEntry,
  DiffResponse,
  LogPage,
  Operation,
  ProjectsResponse,
  RemoteStatusResponse,
  RevertPreview,
  StatusResponse,
  UpdatePreview,
} from '../shared/types.ts';
import { cleanupPreview, startCleanup } from './cleanup.ts';
import { commitPreview, startCommit } from './commit.ts';
import { cleanPatterns, configPath, getConfig, updateConfig } from './config.ts';
import { conflictDetails, resolveConflict, saveMerge } from './conflicts.ts';
import { clearEntries, listEntries } from './console-log.ts';
import { fileDiff } from './diff.ts';
import { historyDiff, historyLog } from './history.ts';
import { HttpError } from './http-error.ts';
import { projectStatus } from './local-status.ts';
import { getOperation } from './operations.ts';
import { discoverProjects, knownProjects, requireProject } from './projects.ts';
import { requireUnlocked } from './read-only.ts';
import { projectRemoteStatus } from './remote-status.ts';
import { revertPreview, startRevert } from './revert.ts';
import { localOnly } from './security.ts';
import { startUpdate, updatePreview } from './update.ts';

const webDist = fileURLToPath(new URL('../dist/web', import.meta.url));

const positiveInt = z.coerce.number().int().positive();

const fileQuery = z.object({ project: z.string().min(1), path: z.string() });

const diffQuery = fileQuery.extend({
  compare: diffCompareSchema.default('local'),
  rev: positiveInt.optional(),
  force: z.enum(['0', '1']).optional(),
});

/** Caminho a partir da raiz do repositório, como o `svn log` mostra (`/projeto/trunk/a.txt`). */
const repoPathSchema = z
  .string()
  .startsWith('/')
  .refine((path) => !path.split('/').some((s) => s === '.' || s === '..'), 'caminho inválido');

/** `?project=a&project=b`: um ou mais projetos. */
const projectIds = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .pipe(z.array(z.string().min(1)).min(1));

const historyQuery = z.object({
  project: projectIds,
  file: z.string().optional(),
  before: positiveInt.optional(),
  beforePath: repoPathSchema.optional(),
  author: z.string().default(''),
  text: z.string().default(''),
});

const historyDiffQuery = z.object({
  project: z.string().min(1),
  path: repoPathSchema,
  rev: positiveInt,
  compare: historyCompareSchema.default('change'),
  local: z.string().optional(),
  force: z.enum(['0', '1']).optional(),
});

const projectsBody = z.object({ projects: z.array(z.string().min(1)).min(1) });

const updateBody = z.object({
  targets: z.array(z.object({ projectId: z.string().min(1), revision: positiveInt })).min(1),
});

const resolveBody = fileQuery.extend({
  accept: resolveAcceptSchema,
});

const mergeBody = fileQuery.extend({
  fingerprint: z.string().min(1),
  choices: z.array(mergeChoiceSchema),
});

function configResponse(): ConfigResponse {
  return { config: getConfig(), configPath };
}

export function createApp(options: { port: number; dev: boolean }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(localOnly(options.port, options.dev));
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();

  api.get('/config', (_req, res) => {
    res.json(configResponse() satisfies ConfigResponse);
  });

  api.put('/config/roots', async (req, res) => {
    const { roots } = z.object({ roots: z.array(z.string()) }).parse(req.body);
    await updateConfig({ roots: roots.map((r) => r.trim()).filter((r) => r !== '') });
    res.json(configResponse());
  });

  api.put('/config/groups', async (req, res) => {
    const { groups } = z.object({ groups: z.array(groupSchema) }).parse(req.body);
    await updateConfig({ groups });
    res.json(configResponse());
  });

  api.put('/config/ignore', async (req, res) => {
    const ignore = ignoreSchema.parse(req.body);
    const projects = Object.fromEntries(
      Object.entries(ignore.projects)
        .map(([id, patterns]) => [id, cleanPatterns(patterns)] as const)
        .filter(([, patterns]) => patterns.length > 0),
    );
    await updateConfig({ ignore: { global: cleanPatterns(ignore.global), projects } });
    res.json(configResponse());
  });

  api.put('/config/read-only', async (req, res) => {
    await updateConfig({ readOnly: readOnlySchema.parse(req.body) });
    res.json(configResponse());
  });

  api.put('/config/polling', async (req, res) => {
    const { remotePolling } = z.object({ remotePolling: z.boolean() }).parse(req.body);
    await updateConfig({ remotePolling });
    res.json(configResponse());
  });

  api.put('/config/commit', async (req, res) => {
    const { template } = z.object({ template: commitReferenceSchema }).parse(req.body);
    await updateConfig({ commitReferenceTemplate: template });
    res.json(configResponse());
  });

  api.get('/projects', async (_req, res) => {
    res.json((await discoverProjects()) satisfies ProjectsResponse);
  });

  api.get('/status', async (_req, res) => {
    const config = getConfig();
    const projects = await knownProjects();
    const statuses = await Promise.all(projects.map((p) => projectStatus(p, config)));
    res.json({ statuses } satisfies StatusResponse);
  });

  api.get('/remote-status', async (_req, res) => {
    const config = getConfig();
    const projects = await knownProjects();
    const statuses = await Promise.all(projects.map((p) => projectRemoteStatus(p, config)));
    res.json({ statuses } satisfies RemoteStatusResponse);
  });

  api.get('/diff', async (req, res) => {
    const query = diffQuery.parse(req.query);
    const project = await requireProject(query.project);
    const diff = await fileDiff(
      project,
      query.path,
      query.compare,
      query.rev ?? null,
      query.force === '1',
    );
    res.json(diff satisfies DiffResponse);
  });

  api.get('/history', async (req, res) => {
    const query = historyQuery.parse(req.query);
    const scope = await Promise.all(query.project.map((id) => requireProject(id)));
    const cursor = query.before ? { before: query.before, path: query.beforePath ?? null } : null;
    const page = await historyLog(scope, query.file ?? null, cursor, query);
    res.json(page satisfies LogPage);
  });

  api.get('/history/diff', async (req, res) => {
    const query = historyDiffQuery.parse(req.query);
    const project = await requireProject(query.project);
    const diff = await historyDiff(
      project,
      query.path,
      query.rev,
      query.compare,
      query.local ?? null,
      query.force === '1',
    );
    res.json(diff satisfies DiffResponse);
  });

  api.post('/update/preview', async (req, res) => {
    const { projects: ids } = projectsBody.parse(req.body);
    const projects = await Promise.all(ids.map((id) => requireProject(id)));
    res.json((await updatePreview(projects, getConfig())) satisfies UpdatePreview);
  });

  api.post('/update', requireUnlocked('local'), async (req, res) => {
    const { targets } = updateBody.parse(req.body);
    const resolved = await Promise.all(
      targets.map(async (t) => ({
        project: await requireProject(t.projectId),
        revision: t.revision,
      })),
    );
    res.status(202).json(startUpdate(resolved) satisfies Operation);
  });

  api.get('/operations/:id', (req, res) => {
    res.json(getOperation(positiveInt.parse(req.params.id)) satisfies Operation);
  });

  api.post('/commit/preview', async (req, res) => {
    const request = commitRequestSchema.parse(req.body);
    res.json((await commitPreview(request, getConfig())) satisfies CommitPreview);
  });

  api.post('/commit', requireUnlocked('commit'), async (req, res) => {
    const { fingerprint, ...request } = commitRequestSchema
      .extend({ fingerprint: z.string().min(1) })
      .parse(req.body);
    res
      .status(202)
      .json((await startCommit(request, getConfig(), fingerprint)) satisfies Operation);
  });

  api.post('/revert/preview', async (req, res) => {
    const request = revertRequestSchema.parse(req.body);
    res.json((await revertPreview(request)) satisfies RevertPreview);
  });

  api.post('/revert', requireUnlocked('local'), async (req, res) => {
    const { fingerprint, ...request } = revertRequestSchema
      .extend({ fingerprint: z.string().min(1) })
      .parse(req.body);
    res.status(202).json((await startRevert(request, fingerprint)) satisfies Operation);
  });

  api.post('/cleanup/preview', async (req, res) => {
    const { projects: ids } = projectsBody.parse(req.body);
    const projects = await Promise.all(ids.map((id) => requireProject(id)));
    res.json(cleanupPreview(projects) satisfies CleanupPreview);
  });

  api.post('/cleanup', requireUnlocked('local'), async (req, res) => {
    const { projects: ids } = projectsBody.parse(req.body);
    const projects = await Promise.all(ids.map((id) => requireProject(id)));
    res.status(202).json(startCleanup(projects) satisfies Operation);
  });

  api.get('/conflict', async (req, res) => {
    const query = fileQuery.extend({ force: z.enum(['0', '1']).optional() }).parse(req.query);
    const project = await requireProject(query.project);
    const details = await conflictDetails(project, query.path, query.force === '1');
    res.json(details satisfies ConflictDetails);
  });

  api.post('/conflict/resolve', requireUnlocked('local'), async (req, res) => {
    const body = resolveBody.parse(req.body);
    const project = await requireProject(body.project);
    res.json((await resolveConflict(project, body.path, body.accept)) satisfies CommandResult);
  });

  api.post('/conflict/merge', requireUnlocked('local'), async (req, res) => {
    const body = mergeBody.parse(req.body);
    const project = await requireProject(body.project);
    const result = await saveMerge(project, body.path, body.fingerprint, body.choices);
    res.json(result satisfies CommandResult);
  });

  api.get('/console', (_req, res) => {
    res.json(listEntries() satisfies ConsoleEntry[]);
  });

  api.delete('/console', (_req, res) => {
    clearEntries();
    res.status(204).end();
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'rota não encontrada' });
  });

  app.use('/api', api);

  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile('index.html', { root: webDist });
    });
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: z.prettifyError(error) });
      return;
    }
    // Erros do próprio Express (ex.: JSON malformado no body-parser) também trazem `status`.
    const status =
      error instanceof HttpError
        ? error.status
        : typeof error?.status === 'number'
          ? error.status
          : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  };
  app.use(onError);

  return app;
}
