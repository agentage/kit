import express, { type Express, type RequestHandler } from 'express';
import {
  agcidMiddleware,
  ok,
  BODY_LIMIT,
  errorHandler,
  notFound,
  localOnly,
} from '@agentage/extension/internal';
import { ownAppOnly } from './app-header.js';
import { appRoutes } from './app-files.js';
import { isAppReload, reloadApp } from './app-reload.js';
import { addExtension } from './add.js';
import { listed, type Entries } from './entries.js';
import { healthRoutes, type DaemonInfo } from './health-routes.js';
import { requireHostToken } from './host-token.js';
import { assertReadable } from './installation.js';
import { changeExtension, removeExtension } from './ops.js';
import { type Pending, type PendingChanges } from './pending.js';
import { waitAtMost } from './queue.js';
import { servesPart } from './lane-routes.js';
import { proxyTo } from './proxy.js';
import { reloadExtension } from './reload.js';
import { shellEvents, type ShellEvents } from './shell-events.js';
import { shellRoutes } from './shell-routes.js';
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

// Each change that went through tells the open shell pages to read discovery again (K7).
const changes = (deps: SupervisorDeps, entries: Entries, info: DaemonInfo, events: ShellEvents) => {
  const queued = runner(deps, info, deps.pending);
  const run = async <T>(what: Omit<Pending, 'since'>, fn: () => Promise<T>) => {
    const done = await queued(what, fn);
    events.send('extensions', { op: what.op, ...(what.id && { id: what.id }) });
    return done;
  };
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
    if (isAppReload(body))
      return void res.json(ok(await queued(what, () => reloadApp(entries, what.id, events))));
    res.json(ok(await run(what, () => reloadExtension(deps, entries, what.id, body))));
  };
  return { add, change, remove, reload };
};

const hostRoutes = (
  app: Express,
  deps: SupervisorDeps,
  entries: Entries,
  info: DaemonInfo,
  events: ShellEvents
) => {
  app.get('/host/extensions', (_req, res) => void res.json(ok([...entries.values()].map(listed))));
  const json = express.json({ limit: BODY_LIMIT });
  const { add, change, remove, reload } = changes(deps, entries, info, events);
  app.post('/host/extensions', json, add);
  app.patch('/host/extensions/:id', json, change);
  app.delete('/host/extensions/:id', remove);
  app.post('/host/extensions/:id/reload', json, reload);
};

// C5 and C1: /health, discovery, /host/* (host token); /api, /mcp, /connector, /files of {id} to the child; S1.2 the shell and /app.
export const daemonApp = (
  deps: SupervisorDeps,
  entries: Entries,
  port: () => number,
  info: DaemonInfo,
  hostToken: string,
  events: ShellEvents = shellEvents()
): Express => {
  const app = express();
  const proxy = proxyTo(entries, deps, hostToken);
  app.disable('x-powered-by');
  app.use(agcidMiddleware, localOnly(port));
  const api = servesPart(entries, 'api');
  const mcp = servesPart(entries, 'mcp');
  app.use('/api/:id', ownAppOnly, api, proxy);
  app.use('/mcp/:id', mcp, proxy);
  app.use('/connector/:id', ownAppOnly, mcp, proxy);
  app.use('/files/:id', ownAppOnly, api, proxy);
  healthRoutes(app, deps, entries, info);
  app.use('/host', requireHostToken(hostToken));
  hostRoutes(app, deps, entries, info, events);
  appRoutes(app, entries);
  shellRoutes(app, { shell: info.shell, entries, events, user: deps.user });
  app.use(notFound);
  app.use(errorHandler(deps.log));
  return app;
};
