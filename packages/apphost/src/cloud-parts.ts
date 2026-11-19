import { type IncomingHttpHeaders } from 'node:http';
import { type RequestHandler } from 'express';
import { fail } from '@agentage/extension/internal';
import { type CloudDiscovery, type Combined } from './cloud-discovery.js';
import { forwardTo } from './cloud-proxy.js';
import { type CloudSession } from './cloud-session.js';

type Part = 'api' | 'mcp' | 'app';
type Route = Combined['routes'][number];

const PART_PATH = /^\/(api|mcp|app)\/([a-z][a-z0-9-]*)(?:\/.*)?$/;

const publicRoute = (routes: Route[], id: string, part: Part) =>
  routes.find((r) => r.id === id && r.part === part && r.expose === 'public');

// 503 with Retry-After for a public part whose entry is starting, down or failed.
export const unavailableIf = ({ document }: Combined, id: string, part: Part): void => {
  const entry = document.extensions.find((e) => e.id === id);
  if (entry?.expose[part] !== 'public' || ['running', 'disabled'].includes(entry.state)) return;
  throw fail('UNAVAILABLE', `${id} is ${entry.state}`, { retryAfter: 5 });
};

// The app part is a page: no credential reaches it; only an /api path is a call of the user.
const headersOf = async (
  session: CloudSession,
  req: Parameters<RequestHandler>[0],
  route: Route
): Promise<IncomingHttpHeaders> => {
  if (route.part === 'app') {
    const rest = { ...req.headers };
    delete rest.cookie;
    delete rest.authorization;
    return rest;
  }
  const exchange = route.part === 'api' && req.path.startsWith('/api/');
  return exchange ? session.headersFor(req, route.id) : req.headers;
};

// Only a public route of a running entry is served; anything else falls through to 404.
export const partRoutes =
  (discovery: CloudDiscovery, session: CloudSession): RequestHandler =>
  async (req, res, next) => {
    const match = PART_PATH.exec(req.path);
    if (!match) return next();
    const [, part, id] = match as unknown as [string, Part, string];
    const combined = discovery.current();
    const route = publicRoute(combined.routes, id, part);
    if (!route) unavailableIf(combined, id, part);
    if (!route || (part === 'app' && req.method !== 'GET')) return next();
    const headers = await headersOf(session, req, route);
    forwardTo(req, res, next, { id, prefix: route.prefix, upstream: route.upstream, headers });
  };
