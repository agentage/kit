import express, { type Express } from 'express';
import { agcidMiddleware, errorHandler, type Log, notFound } from '@agentage/extension/internal';
import { type CloudDiscovery } from './cloud-discovery.js';
import { type CloudEnv } from './cloud-env.js';
import { ownHostOnly } from './cloud-guards.js';
import { cloudHealth } from './cloud-health.js';
import { type ShellEvents } from './shell-events.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const HOST_DOC = '/.well-known/agentage-host.json';

export interface CloudParts {
  env: CloudEnv;
  host: string;
  discovery: CloudDiscovery;
  events: ShellEvents;
  log: Log;
}

// The cloud host: /health, then Host allow-listed, the host document and the shell feed.
export const cloudApp = (parts: CloudParts): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(agcidMiddleware);
  app.get('/health', cloudHealth(parts.host, parts.env));
  app.use(ownHostOnly(parts.env.own, parts.env.local));
  app.get(HOST_DOC, (_req, res) => void res.set(NO_STORE).json(parts.discovery.current().document));
  // One feed per host: it says what changed for every user, never a session event.
  app.get('/shell/events', parts.events.stream);
  app.use(notFound);
  app.use(errorHandler(parts.log));
  return app;
};
