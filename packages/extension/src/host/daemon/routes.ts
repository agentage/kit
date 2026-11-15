import express, { type Express, type RequestHandler } from 'express';
import { agcidMiddleware } from '../../agcid/scope.js';
import { ok } from '../../envelope/envelope.js';
import { BODY_LIMIT } from '../../server/app.js';
import { errorHandler, notFound } from '../../server/errors.js';
import { localOnly } from './guard.js';
import {
  addExtension,
  changeExtension,
  listed,
  removeExtension,
  summary,
  type Entries,
} from './ops.js';
import { proxyTo } from './proxy.js';
import { type SupervisorDeps } from './supervisor.js';

// One change at a time: two installs never race on installation.json or on one extension.
const serial = () => {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
};

const healthOf = (entries: Entries, version: string) => {
  const all = [...entries.values()];
  const settled = all.every((e) => e.state === 'running' || e.state === 'disabled');
  return { status: settled ? 'ok' : 'degraded', version, extensions: all.map(summary) };
};

const changes = (deps: SupervisorDeps, entries: Entries) => {
  const run = serial();
  const id = (params: Record<string, string | string[]>) => String(params['id']);
  const add: RequestHandler = async (req, res) =>
    void res.status(201).json(ok(await run(() => addExtension(deps, entries, req.body))));
  const change: RequestHandler = async (req, res) =>
    void res.json(ok(await run(() => changeExtension(deps, entries, id(req.params), req.body))));
  const purge = (q: unknown) => (q as Record<string, unknown>)['purge'] === 'true';
  const remove: RequestHandler = async (req, res) =>
    void res.json(
      ok(await run(() => removeExtension(deps, entries, id(req.params), purge(req.query))))
    );
  return { add, change, remove };
};

const hostRoutes = (app: Express, deps: SupervisorDeps, entries: Entries): void => {
  app.get('/host/extensions', (_req, res) => void res.json(ok([...entries.values()].map(listed))));
  const json = express.json({ limit: BODY_LIMIT });
  const { add, change, remove } = changes(deps, entries);
  app.post('/host/extensions', json, add);
  app.patch('/host/extensions/:id', json, change);
  app.delete('/host/extensions/:id', remove);
};

// C5: /health, /host/extensions, and /api/{id}/* to the child of that id; Host and Origin first.
export const daemonApp = (
  deps: SupervisorDeps,
  entries: Entries,
  port: () => number,
  version: string
): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(agcidMiddleware, localOnly(port));
  app.use('/api/:id', proxyTo(entries));
  app.get(
    '/health',
    (_req, res) => void res.set('Cache-Control', 'no-store').json(healthOf(entries, version))
  );
  hostRoutes(app, deps, entries);
  app.use(notFound);
  app.use(errorHandler(deps.log));
  return app;
};
