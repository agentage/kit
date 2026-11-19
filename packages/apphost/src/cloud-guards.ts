import { type RequestHandler } from 'express';
import { fail } from '@agentage/extension/internal';
import { isLoopbackName } from './cloud-env.js';

const BASE = 'http://local';
// res.locals key: the request came as HEAD (served as GET with no body).
export const HEAD = 'head';

// Origin-form only: a target that names a host (`//h`, `/\h`, `http://h/`) would send a proxy off its upstream.
export const originForm = (target: string): boolean =>
  /^\/(?![/\\])[^\\]*$/.test(target.split('?')[0] ?? '') &&
  URL.canParse(target, BASE) &&
  new URL(target, BASE).origin === BASE;

// One path for every route: dot segments (also %2e%2e) resolved once, as the stub router read them.
export const normalPath = (target: string): string => {
  const url = new URL(target, BASE);
  return `${url.pathname}${url.search}`;
};

// Before every route: the target form, one normalized path, and HEAD as GET with no body.
export const requestGuard: RequestHandler = (req, res, next) => {
  if (!originForm(req.url))
    throw fail('VALIDATION_ERROR', 'request target is not origin-form', { code: 'BAD_REQUEST' });
  req.url = req.originalUrl = normalPath(req.url);
  // A kit that skips its scope check on HEAD leaks nothing: node already sends no body.
  if (req.method === 'HEAD') {
    req.method = 'GET';
    res.locals[HEAD] = true;
  }
  next();
};

const hostnameOf = (host: string) =>
  URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname : '';

// Host allow-listed against AGENTAGE_URL; a local run also takes the local router address.
export const ownHostOnly =
  (own: string, local: boolean): RequestHandler =>
  (req, _res, next) => {
    const host = req.headers.host ?? '';
    if (host === new URL(own).host || (local && isLoopbackName(hostnameOf(host)))) return next();
    throw fail('VALIDATION_ERROR', 'not a name of this host', { code: 'UNKNOWN_HOST' });
  };
