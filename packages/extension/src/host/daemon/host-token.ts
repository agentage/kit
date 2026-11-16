import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type IncomingHttpHeaders } from 'node:http';
import { type RequestHandler } from 'express';
import { fail } from '../../envelope/envelope.js';

// D11: a new token at each daemon start, in daemon.json (0600); a sealed child cannot read it.
export const newHostToken = (): string => randomBytes(32).toString('base64url');

const bearerOf = (headers: IncomingHttpHeaders): string | undefined => {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headers.authorization ?? '');
  return match?.[1];
};

// Digests first: timingSafeEqual needs equal lengths, and the length of the token stays unseen.
const sameToken = (given: string, token: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(token).digest()
  );

// True when the request carries the host token: the proxy then keeps it from the child.
export const carriesHostToken = (headers: IncomingHttpHeaders, token: string): boolean => {
  const given = bearerOf(headers);
  return given !== undefined && sameToken(given, token);
};

// A cli that sends no token was made before the host token (C3): the fix is a newer cli or a restart.
export const NO_TOKEN =
  'host token required: this cli is older than the daemon, update @agentage/cli or run "agentage daemon restart"';

// Every /host/* route: 401 with no bearer, 403 with another one.
export const requireHostToken =
  (token: string): RequestHandler =>
  (req, _res, next) => {
    const given = bearerOf(req.headers);
    if (given === undefined) throw fail('UNAUTHORIZED', NO_TOKEN);
    if (!sameToken(given, token)) throw fail('FORBIDDEN', 'The host token is not valid');
    next();
  };
