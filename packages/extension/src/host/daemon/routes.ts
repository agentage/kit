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

// What /health says of the daemon itself: the values of daemon.json, so a client can prove it.
export const DAEMON_SERVICE = 'agentage-daemon';

export interface DaemonInfo {
  version: string;
  pid: number;
  protocol: number;
  // installation.json had rows (or a shape) C3 refuses: they are left out, the file kept as .bad.
  invalid: boolean;
}

const healthOf = (entries: Entries, { version, pid, protocol, invalid }: DaemonInfo) => {
  const all = [...entries.values()];
  const settled = !invalid && all.every((e) => e.state === 'running' || e.state === 'disabled');
  const extensions = all.map(summary);
  const status = settled ? 'ok' : 'degraded';
  const self = { service: DAEMON_SERVICE, pid, protocol };
  return { status, version, ...self, extensions, ...(invalid && { installation: 'invalid' }) };
};

const changes = (deps: SupervisorDeps, entries: Entries) => {
  const run = deps.queue;
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
  info: DaemonInfo
): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(agcidMiddleware, localOnly(port));
  app.use('/api/:id', proxyTo(entries));
  app.get(
    '/health',
    (_req, res) => void res.set('Cache-Control', 'no-store').json(healthOf(entries, info))
  );
  hostRoutes(app, deps, entries);
  app.use(notFound);
  app.use(errorHandler(deps.log));
  return app;
};
