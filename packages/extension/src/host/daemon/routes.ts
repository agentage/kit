import express, { type Express, type RequestHandler } from 'express';
import { agcidMiddleware } from '../../agcid/scope.js';
import { ok } from '../../envelope/envelope.js';
import { BODY_LIMIT } from '../../server/app.js';
import { errorHandler, notFound } from '../../server/errors.js';
import { localOnly } from './guard.js';
import { addExtension } from './add.js';
import { listed, summary, type Entries } from './entries.js';
import { assertReadable } from './installation.js';
import { changeExtension, removeExtension } from './ops.js';
import { type Pending, type PendingChanges } from './pending.js';
import { waitAtMost } from './queue.js';
import { proxyTo } from './proxy.js';
import { type SupervisorDeps } from './supervisor.js';

// What /health says of the daemon itself: the values of daemon.json, so a client can prove it.
const DAEMON_SERVICE = 'agentage-daemon';

interface DaemonInfo {
  version: string;
  pid: number;
  protocol: number;
  // installation.json had rows (or a shape) C3 refuses: they are left out, the file kept as .bad.
  invalid: boolean;
  // installation.json could not be read at boot: every change is refused, the file is never written.
  unreadable?: string;
}

const installationOf = ({ invalid, unreadable }: DaemonInfo) => {
  if (unreadable) return { installation: 'unreadable', installationError: unreadable };
  return invalid ? { installation: 'invalid' } : {};
};

const healthOf = (entries: Entries, info: DaemonInfo, pending: PendingChanges) => {
  const all = [...entries.values()];
  const settled = all.every((e) => e.state === 'running' || e.state === 'disabled');
  const status = settled && !info.invalid && !info.unreadable ? 'ok' : 'degraded';
  const self = { service: DAEMON_SERVICE, pid: info.pid, protocol: info.protocol };
  const extensions = all.map(summary);
  const changing = pending.list();
  const busy = changing.length ? { pending: changing } : {};
  return { status, version: info.version, ...self, extensions, ...busy, ...installationOf(info) };
};

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
        await assertReadable(deps.configDir, info.unreadable);
        return fn();
      })
    );

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
  const purge = (q: unknown) => (q as Record<string, unknown>)['purge'] === 'true';
  const remove: RequestHandler = async ({ params, query }, res) => {
    const what = { op: 'remove' as const, id: id(params) };
    res.json(ok(await run(what, () => removeExtension(deps, entries, what.id, purge(query)))));
  };
  return { add, change, remove };
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
  const { add, change, remove } = changes(deps, entries, info, p);
  app.post('/host/extensions', json, add);
  app.patch('/host/extensions/:id', json, change);
  app.delete('/host/extensions/:id', remove);
};

// C5: /health, /host/extensions, and /api/{id}/* to the child of that id; Host and Origin first.
export const daemonApp = (
  deps: SupervisorDeps,
  entries: Entries,
  port: () => number,
  info: DaemonInfo
): Express => {
  const app = express();
  const pending = deps.pending;
  app.disable('x-powered-by');
  app.use(agcidMiddleware, localOnly(port));
  app.use('/api/:id', proxyTo(entries, deps));
  app.get(
    '/health',
    (_req, res) => void res.set('Cache-Control', 'no-store').json(healthOf(entries, info, pending))
  );
  hostRoutes(app, deps, entries, info, pending);
  app.use(notFound);
  app.use(errorHandler(deps.log));
  return app;
};
