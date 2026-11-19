import { type IncomingHttpHeaders } from 'node:http';
import { type RequestHandler } from 'express';
import { fail } from '@agentage/extension/internal';
import { type CloudDiscovery, type Combined } from './cloud-discovery.js';
import { forwardTo } from './cloud-proxy.js';
import { type CloudSession } from './cloud-session.js';
import { type Route, type RoutedPart, routeOf } from './route-of.js';

// 503 with Retry-After for a public part whose entry is starting, down or failed.
export const unavailableIf = ({ document }: Combined, id: string, part: RoutedPart): void => {
  const entry = document.extensions.find((e) => e.id === id);
  if (entry?.expose[part] !== 'public' || ['running', 'disabled'].includes(entry.state)) return;
  throw fail('UNAVAILABLE', `${id} is ${entry.state}`, { retryAfter: 5 });
};

// The app part is a page: no credential reaches it; only an /api path is a call of the user.
// A well-known name sent to the api part (D82) is anonymous: no token is exchanged for it.
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

// Only a public route of a running entry is served, then the site of a pages host; else 404.
export const partRoutes =
  (discovery: CloudDiscovery, session: CloudSession): RequestHandler =>
  async (req, res, next) => {
    const combined = discovery.current();
    const hit = routeOf(combined.routes, req.path);
    if (hit && !('route' in hit)) unavailableIf(combined, hit.id, hit.part);
    if (!hit || !('route' in hit)) return next();
    const { route, under } = hit;
    if (route.part === 'app' && req.method !== 'GET') return next();
    const headers = await headersOf(session, req, route);
    forwardTo(req, res, next, { id: route.id, prefix: under, upstream: route.upstream, headers });
  };
