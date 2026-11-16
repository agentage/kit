import express, { type Express, type RequestHandler } from 'express';
import { agcidMiddleware } from '../../agcid/scope.js';
import { ok } from '../../envelope/envelope.js';
import { BODY_LIMIT } from '../../server/app.js';
import { errorHandler, notFound } from '../../server/errors.js';
import { localOnly } from './guard.js';
import { addExtension } from './add.js';
import { listed, type Entries } from './entries.js';
import { healthRoutes, type DaemonInfo } from './health-routes.js';
import { requireHostToken } from './host-token.js';
import { assertReadable } from './installation.js';
import { changeExtension, removeExtension } from './ops.js';
import { type Pending, type PendingChanges } from './pending.js';
import { waitAtMost } from './queue.js';
import { proxyTo } from './proxy.js';
import { reloadExtension } from './reload.js';
import { stopsNow } from './stopping.js';
import { type SupervisorDeps } from './supervisor.js';

const reasonOf = (err: unknown) => (err as { details?: { reason?: string } }).details?.reason;

// A refusal for a file that turned not JSON shows in /health until a change reads the file again.
const checkReadable = (deps: SupervisorDeps, info: DaemonInfo) =>
  assertReadable(deps.configDir, info.unreadable).then(
    () => void (info.notJson = false),
    (err: unknown) => {
      info.notJson = reasonOf(err) === 'not JSON';
      throw err;
    }
  );

// What a POST body names, for /health: the id, or the folder.
const named = (body: unknown): Omit<Pending, 'op' | 'since'> => {
  const { id, source } = (body ?? {}) as Record<string, unknown>;
  if (typeof id === 'string') return { id };
  return typeof source === 'string' ? { source } : {};
};

// Every change in the queue, and none while installation.json cannot be read.
const runner =
  (deps: SupervisorDeps, info: DaemonInfo, p: PendingChanges) =>
  <T>(what: Omit<Pending, 'since'>, fn: () => Promise<T>) =>
    p.track(what, () =>
      waitAtMost(deps.queue, deps.installMs, async () => {
        if (deps.stopping.signal.aborted) throw stopsNow();
        await checkReadable(deps, info);
        return fn();
      })
    );

const purge = (q: unknown) => (q as Record<string, unknown>)['purge'] === 'true';

const changes = (deps: SupervisorDeps, entries: Entries, info: DaemonInfo, p: PendingChanges) => {
  const run = runner(deps, info, p);
  const id = (params: Record<string, string | string[]>) => String(params['id']);
  const add: RequestHandler = async (req, res) => {
    const what = { op: 'install' as const, ...named(req.body) };
    res.status(201).json(ok(await run(what, () => addExtension(deps, entries, req.body))));
  };
  const change: RequestHandler = async ({ params, body }, res) => {
    const what = { op: 'update' as const, id: id(params) };
    res.json(ok(await run(what, () => changeExtension(deps, entries, id(params), body))));
  };
  const remove: RequestHandler = async ({ params, query }, res) => {
    const what = { op: 'remove' as const, id: id(params) };
    res.json(ok(await run(what, () => removeExtension(deps, entries, what.id, purge(query)))));
  };
  const reload: RequestHandler = async ({ params, body }, res) => {
    const what = { op: 'reload' as const, id: id(params) };
    res.json(ok(await run(what, () => reloadExtension(deps, entries, what.id, body))));
  };
  return { add, change, remove, reload };
};

const hostRoutes = (
  app: Express,
  deps: SupervisorDeps,
  entries: Entries,
  info: DaemonInfo,
  p: PendingChanges
) => {
  app.get('/host/extensions', (_req, res) => void res.json(ok([...entries.values()].map(listed))));
  const json = express.json({ limit: BODY_LIMIT });
  const { add, change, remove, reload } = changes(deps, entries, info, p);
  app.post('/host/extensions', json, add);
  app.patch('/host/extensions/:id', json, change);
  app.delete('/host/extensions/:id', remove);
  app.post('/host/extensions/:id/reload', json, reload);
};

// C5 and C1: /health, discovery, /host/* (host token); /api, /mcp, /connector, /files of {id} to the child.
export const daemonApp = (
  deps: SupervisorDeps,
  entries: Entries,
  port: () => number,
  info: DaemonInfo,
  hostToken: string
): Express => {
  const app = express();
  const proxy = proxyTo(entries, deps, hostToken);
  app.disable('x-powered-by');
  app.use(agcidMiddleware, localOnly(port));
  app.use('/api/:id', proxy);
  app.use('/mcp/:id', proxy);
  app.use('/connector/:id', proxy);
  app.use('/files/:id', proxy);
  healthRoutes(app, deps, entries, info);
  app.use('/host', requireHostToken(hostToken));
  hostRoutes(app, deps, entries, info, deps.pending);
  app.use(notFound);
  app.use(errorHandler(deps.log));
  return app;
};
