import express, { type Express } from 'express';
import { agcidMiddleware, errorHandler, type Log, notFound } from '@agentage/extension/internal';
import { requestLine } from '@agentage/extension/internal';
import { authMirror } from './cloud-auth-mirror.js';
import { type CloudDiscovery } from './cloud-discovery.js';
import { closeWhileDraining } from './cloud-drain.js';
import { type CloudEnv } from './cloud-env.js';
import { HEAD, ownHostOnly, requestGuard } from './cloud-guards.js';
import { cloudHealth } from './cloud-health.js';
import { cloudPageRule } from './cloud-page.js';
import { partRoutes } from './cloud-parts.js';
import { recordRoutes } from './cloud-records.js';
import { hostHeaders } from './security-headers.js';
import { streamRoutes } from './cloud-streams.js';
import { CLOUD_SIGN_OUT, type CloudSession } from './cloud-session.js';
import { HOST_DOC, ROUTER_DOC } from './route-of.js';
import { type ShellEvents } from './shell-events.js';
import { type Shell, shellFiles } from './shell-routes.js';

const NO_STORE = { 'Cache-Control': 'no-store' };

export interface CloudParts {
  env: CloudEnv;
  host: string;
  discovery: CloudDiscovery;
  session: CloudSession;
  events: ShellEvents;
  // Set only for a host with a `shell` key: / and /shell/* serve it.
  shell?: Shell | undefined;
  log: Log;
  // The fetch of auth calls: the exchange, the sign-out, the metadata mirror.
  fetcher?: typeof fetch | undefined;
  draining(): boolean;
}

// The session answer on every host (the host contract reads it): no-store, no CORS header.
// Sign-out and the feed only with a shell key; else they fall through to the site or a 404.
const shellRoutes = (app: Express, { session, events, shell }: CloudParts) => {
  app.get('/shell/session', async (req, res) => {
    res.set(NO_STORE).json(await session.answer(req));
  });
  if (!shell) return;
  app.post(CLOUD_SIGN_OUT, session.signOut);
  // One feed per host: it says what changed for every user, never a session event.
  app.get('/shell/events', (req, res, next) => {
    // A HEAD has no body to stream: the headers, then the end.
    if (!res.locals[HEAD]) return void events.stream(req, res, next);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }).end();
  });
};

// The cloud host, in the stub router's order: health, Host, documents, shell, streams, parts, site.
export const cloudApp = (parts: CloudParts): Express => {
  const app = express();
  app.disable('x-powered-by');
  const headers = hostHeaders(parts.env.own.startsWith('https:'));
  app.use(agcidMiddleware, headers, closeWhileDraining(parts.draining), requestGuard);
  app.get('/health', cloudHealth(parts.host, parts.env, parts.draining, parts.discovery.ready));
  // After /health, as in the kit: the probe reads it every few seconds. No ctx.exit on a host.
  app.use(requestLine(parts.log, () => undefined));
  app.use(ownHostOnly(parts.env.own, parts.env.local));
  app.get(HOST_DOC, (_req, res) => void res.set(NO_STORE).json(parts.discovery.current().document));
  // The program's own version and commit, also in the host document when the commit is known.
  const { version, commit } = parts.env.build;
  app.get(ROUTER_DOC, (_req, res) => void res.set(NO_STORE).json({ version, commit }));
  app.use(recordRoutes(parts.discovery, parts.env.own, { fetcher: parts.fetcher }));
  app.use(authMirror(parts.env.issuer, { fetcher: parts.fetcher }));
  shellRoutes(app, parts);
  app.use(streamRoutes(parts.discovery));
  app.use(partRoutes(parts.discovery, parts.session));
  if (parts.shell) shellFiles(app, parts.shell, cloudPageRule(parts.discovery));
  app.use(notFound);
  app.use(errorHandler(parts.log));
  return app;
};
