import { isIP } from 'node:net';
import { type RequestHandler, type Response } from 'express';
import { fail } from '@agentage/extension/internal';
import { authDown } from './auth-answer.js';
import { type Credential, foreignPage, sessionCookies } from './cloud-credentials.js';

const SIGN_OUT_MS = 5000;
const NO_STORE = { 'Cache-Control': 'no-store' };

export interface SignOutOptions {
  issuer: string | null;
  own: string;
  forget(credential: Credential): void;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const askAuth = (options: SignOutOptions & { issuer: string }, cookie: string) =>
  (options.fetcher ?? fetch)(`${options.issuer}/api/auth/sign-out`, {
    method: 'POST',
    // Auth refuses a sign-out whose Origin is not its own.
    headers: { 'content-type': 'application/json', origin: options.issuer, cookie },
    body: '{}',
    signal: AbortSignal.timeout(options.timeoutMs ?? SIGN_OUT_MS),
  }).catch(() => null);

// The clear of each session cookie when auth sent none: the Domain auth sets (the issuer's parent).
export const clearsOf = (cookie: string, issuer: string): string[] => {
  const { hostname } = new URL(issuer);
  const labels = hostname.split('.');
  const parent = labels.length > 2 && !isIP(hostname);
  const domain = parent ? `; Domain=.${labels.slice(1).join('.')}` : '';
  return cookie.split(';').map((part) => {
    const name = part.trim().split('=')[0] ?? '';
    const scoped = name.startsWith('__Host-') ? '' : domain;
    return `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax${scoped}`;
  });
};

const done = (res: Response, cleared: string[] = []) => {
  res.set(NO_STORE);
  if (cleared.length > 0) res.append('Set-Cookie', cleared);
  res.status(200).json({ success: true });
};

// Auth's own 4xx status, with the wire code SIGN_OUT_REFUSED (the base code only sets the shape).
const refused = (status: number) =>
  Object.assign(
    fail('VALIDATION_ERROR', 'auth refused the sign-out', { code: 'SIGN_OUT_REFUSED' }),
    { status }
  );

const relay = (res: Response, up: globalThis.Response, cookie: string, issuer: string) => {
  if (up.status === 429 || up.status >= 500) throw authDown('auth cannot sign out now');
  if (up.status >= 400 && up.status !== 401) {
    res.set(NO_STORE).append('Set-Cookie', clearsOf(cookie, issuer));
    throw refused(up.status);
  }
  // The clear (Domain .agentage.io) signs the browser out at every host replica.
  const cleared = up.headers.getSetCookie();
  done(res, cleared.length === 0 && up.status === 401 ? clearsOf(cookie, issuer) : cleared);
};

// POST /shell/sign-out: end the auth session and drop the cached tokens of that cookie at once.
export const createCloudSignOut =
  (options: SignOutOptions): RequestHandler =>
  async (req, res) => {
    if (foreignPage(req, options.own)) throw fail('FORBIDDEN', 'not a page of this host');
    const cookie = sessionCookies(req.headers.cookie);
    const { issuer } = options;
    if (!cookie || !issuer) return done(res);
    const up = await askAuth({ ...options, issuer }, cookie).finally(() =>
      options.forget({ cookie })
    );
    if (!up) throw authDown('auth cannot sign out now');
    relay(res, up, cookie, issuer);
  };
