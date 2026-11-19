import { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { type NextFunction, type Request, type Response } from 'express';
import { fail } from '@agentage/extension/internal';
import { withoutCredentials } from './cloud-credentials.js';
import { endToEnd, pipeTo } from './proxy.js';

// e2e reads 502 for an upstream that does not answer on a cloud host (not the daemon's 503).
export const badGateway = (id: string) =>
  Object.assign(fail('UNAVAILABLE', `${id} did not answer`), {
    code: 'BAD_GATEWAY',
    status: 502,
    retryAfter: undefined,
  });

export const pathLeaves = () =>
  fail('VALIDATION_ERROR', 'path leaves the upstream', { code: 'BAD_REQUEST' });

// The x-agentage-* headers a client may send, each only in its short form (extension-platform reads the cli version).
const CLIENT_HEADERS = new Map([
  ['x-agentage-cli-version', /^\d{1,9}\.\d{1,9}\.\d{1,9}(-[0-9A-Za-z.-]{1,32})?$/],
]);

const passes = ([name, value]: [string, unknown]) =>
  !name.startsWith('x-agentage-') ||
  (typeof value === 'string' && CLIENT_HEADERS.get(name)?.test(value) === true);

// What an upstream gets: no hop header, no other client x-agentage-* header, no credential but a PAT.
export const upstreamHeaders = (headers: IncomingHttpHeaders): IncomingHttpHeaders =>
  Object.fromEntries(Object.entries(withoutCredentials(endToEnd(headers))).filter(passes));

// No upstream sets a cookie on the host origin: it would also reach auth and every sibling host.
const answerHeaders = (up: IncomingMessage, set: Record<string, string> = {}) => {
  const rest = endToEnd(up.headers);
  delete rest['set-cookie'];
  return { ...rest, ...set };
};

export interface CloudForward {
  id: string;
  // The route's path prefix (/api/{id}): a dot segment must not take the path out of it.
  prefix: string;
  upstream: string;
  headers: IncomingHttpHeaders;
  // The path sent (default: the request's own); `prefix` guards it too.
  path?: string;
  // Answer headers set over the upstream's (lower case names).
  answer?: Record<string, string>;
}

const leaves = (target: URL, origin: URL, prefix: string) =>
  target.origin !== origin.origin ||
  (target.pathname !== prefix && !target.pathname.startsWith(prefix.replace(/\/?$/, '/')));

// Streams req to the upstream origin at its own path; a path off the origin or the route is refused.
export const forwardTo = (req: Request, res: Response, next: NextFunction, to: CloudForward) => {
  const origin = new URL(to.upstream);
  const target = new URL(to.path ?? req.originalUrl, origin);
  if (leaves(target, origin, to.prefix)) return next(pathLeaves());
  pipeTo(req, res, {
    address: to.upstream,
    path: `${target.pathname}${target.search}`,
    headers: upstreamHeaders(to.headers),
    answerHeaders: (answer) => answerHeaders(answer, to.answer),
    failed: () => next(badGateway(to.id)),
  });
};
