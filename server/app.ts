import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { groupSchema, ignoreSchema, readOnlySchema } from '../shared/schema.ts';
import type {
  ConfigResponse,
  ConsoleEntry,
  DiffResponse,
  ProjectsResponse,
  StatusResponse,
} from '../shared/types.ts';
import { cleanPatterns, configPath, getConfig, updateConfig } from './config.ts';
import { clearEntries, listEntries } from './console-log.ts';
import { localDiff } from './diff.ts';
import { projectStatus } from './local-status.ts';
import { discoverProjects, knownProjects, requireProject } from './projects.ts';
import { localOnly } from './security.ts';

const webDist = fileURLToPath(new URL('../dist/web', import.meta.url));

const diffQuery = z.object({
  project: z.string().min(1),
  path: z.string(),
  force: z.enum(['0', '1']).optional(),
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

  api.get('/projects', async (_req, res) => {
    res.json((await discoverProjects()) satisfies ProjectsResponse);
  });

  api.get('/status', async (_req, res) => {
    const config = getConfig();
    const projects = await knownProjects();
    const statuses = await Promise.all(projects.map((p) => projectStatus(p, config)));
    res.json({ statuses } satisfies StatusResponse);
  });

  api.get('/diff', async (req, res) => {
    const query = diffQuery.parse(req.query);
    const project = await requireProject(query.project);
    const diff = await localDiff(project, query.path, query.force === '1');
    res.json(diff satisfies DiffResponse);
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
    const status = typeof error?.status === 'number' ? error.status : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  };
  app.use(onError);

  return app;
}
