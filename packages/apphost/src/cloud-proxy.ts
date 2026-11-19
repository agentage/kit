import { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { type NextFunction, type Request, type Response } from 'express';
import { fail } from '@agentage/extension/internal';
import { withoutCredentials } from './cloud-credentials.js';
import { endToEnd, targetOf } from './proxy.js';

// e2e reads 502 for an upstream that does not answer on a cloud host (not the daemon's 503).
export const badGateway = (id: string) =>
  Object.assign(fail('UNAVAILABLE', `${id} did not answer`), {
    code: 'BAD_GATEWAY',
    status: 502,
    retryAfter: undefined,
  });

export const pathLeaves = () =>
  fail('VALIDATION_ERROR', 'path leaves the upstream', { code: 'BAD_REQUEST' });

// What an upstream gets: no hop header, no client x-agentage-* header, no credential but a PAT.
export const upstreamHeaders = (headers: IncomingHttpHeaders): IncomingHttpHeaders =>
  Object.fromEntries(
    Object.entries(withoutCredentials(endToEnd(headers))).filter(
      ([name]) => !name.startsWith('x-agentage-')
    )
  );

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
  const { send, host, port, servername } = targetOf(to.upstream);
  const path = `${target.pathname}${target.search}`;
  const headers = upstreamHeaders(to.headers);
  const { method } = req;
  const up = send({ host, port, servername, method, path, headers, agent: false });
  up.on('response', (answer) => {
    res.writeHead(answer.statusCode ?? 502, answerHeaders(answer, to.answer));
    // An upstream gone in the middle of its body: the answer is cut, not left open.
    answer.once('close', () => void (answer.complete || res.destroy()));
    answer.pipe(res);
  });
  up.on('error', () => (res.headersSent ? res.destroy() : next(badGateway(to.id))));
  res.on('close', () => void (res.writableFinished || up.destroy()));
  req.pipe(up);
};
