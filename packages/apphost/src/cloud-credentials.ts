import { type IncomingHttpHeaders } from 'node:http';

// What the cloud session reads of a request: an express Request fits.
export interface CloudRequest {
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string | undefined } | undefined;
}

// The desktop sends a bearer; the browser sends the auth session cookies.
export type Credential = { cookie: string } | { authorization: string };

// Every auth cookie (session, session data, dont_remember, ...), with or without a __Secure-/__Host- prefix.
const COOKIE = /^(__Secure-|__Host-)?better-auth[.-]/;
// A PAT and git Basic pass to the upstream as sent; any other bearer is exchanged or dropped.
const KEPT_AUTHORIZATION = /^(bearer\s+aga_|basic\s)/i;
const PAT_PREFIX = 'aga_';

const partsOf = (header = '') =>
  header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

const isAuthCookie = (part: string) => COOKIE.test(part.split('=')[0] ?? '');

// Only the auth session cookies of a Cookie header, or ''.
export const sessionCookies = (header?: string): string =>
  partsOf(header).filter(isAuthCookie).join('; ');

// Upstream headers on every route: no auth cookie; of the bearers only a PAT or the host's token.
export const withoutCredentials = (headers: IncomingHttpHeaders): IncomingHttpHeaders => {
  const { cookie, authorization, ...rest } = headers;
  const kept = partsOf(cookie).filter((part) => !isAuthCookie(part));
  return {
    ...rest,
    ...(kept.length > 0 && { cookie: kept.join('; ') }),
    ...(authorization && KEPT_AUTHORIZATION.test(authorization) && { authorization }),
  };
};

// The client address the edge appended last; a client cannot forge the last entry.
export const addressOf = (req: CloudRequest): string => {
  const forwarded = req.headers['x-forwarded-for'];
  const list = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',');
  const last = list
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return last ?? req.socket?.remoteAddress ?? '';
};

// A non-PAT bearer (the desktop) or the session cookies; null when the request has none.
export const credentialOf = (req: CloudRequest): Credential | null => {
  const bearer = /^bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (bearer) return bearer.startsWith(PAT_PREFIX) ? null : { authorization: `Bearer ${bearer}` };
  const cookie = sessionCookies(req.headers.cookie);
  return cookie ? { cookie } : null;
};

// A sibling page under the cookie domain sends the cookie too: only the host's own pages may use it.
export const foreignPage = (req: CloudRequest, own: string): boolean => {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return true;
  return Boolean(req.headers.origin) && req.headers.origin !== own;
};
