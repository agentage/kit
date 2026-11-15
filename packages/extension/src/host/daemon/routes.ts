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

const healthOf = (entries: Entries, info: DaemonInfo) => {
  const all = [...entries.values()];
  const settled = all.every((e) => e.state === 'running' || e.state === 'disabled');
  const status = settled && !info.invalid && !info.unreadable ? 'ok' : 'degraded';
  const self = { service: DAEMON_SERVICE, pid: info.pid, protocol: info.protocol };
  const extensions = all.map(summary);
  return { status, version: info.version, ...self, extensions, ...installationOf(info) };
};

// Every change in the queue, and none while installation.json cannot be read.
const changes = (deps: SupervisorDeps, entries: Entries, info: DaemonInfo) => {
  const run = <T>(fn: () => Promise<T>) =>
    deps.queue(async () => (await assertReadable(deps.configDir, info.unreadable), fn()));
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

const hostRoutes = (app: Express, deps: SupervisorDeps, entries: Entries, info: DaemonInfo) => {
  app.get('/host/extensions', (_req, res) => void res.json(ok([...entries.values()].map(listed))));
  const json = express.json({ limit: BODY_LIMIT });
  const { add, change, remove } = changes(deps, entries, info);
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
  app.disable('x-powered-by');
  app.use(agcidMiddleware, localOnly(port));
  app.use('/api/:id', proxyTo(entries, deps));
  app.get(
    '/health',
    (_req, res) => void res.set('Cache-Control', 'no-store').json(healthOf(entries, info))
  );
  hostRoutes(app, deps, entries, info);
  app.use(notFound);
  app.use(errorHandler(deps.log));
  return app;
};
