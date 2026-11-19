import { type RequestHandler } from 'express';
import { fail } from '@agentage/extension/internal';

// The authorization server metadata that clients of today read at the host root (J.5.3).
export const AS_PATH = '/.well-known/oauth-authorization-server';
const TTL_MS = 10 * 60_000;
const ANSWER = {
  'content-type': 'application/json',
  'cache-control': 'public, max-age=600',
  'access-control-allow-origin': '*',
};

export interface MirrorOptions {
  fetcher?: typeof fetch;
  readMs?: number;
  now?: () => number;
}

const unavailable = (why: string) => fail('UNAVAILABLE', why, { retryAfter: 5 });

const issuerIn = (body: string) => {
  try {
    return typeof (JSON.parse(body) as { issuer?: unknown } | null)?.issuer === 'string';
  } catch {
    return false;
  }
};

// Copied as auth sent it; a 404, 5xx, timeout or non-JSON answer is 503 and is not cached.
export const authMirror = (issuer: string | null, o: MirrorOptions = {}): RequestHandler => {
  const [fetcher, readMs, now] = [o.fetcher ?? fetch, o.readMs ?? 3_000, o.now ?? Date.now];
  let cached: { at: number; body: string } | undefined;
  let inFlight: Promise<{ at: number; body: string }> | undefined;
  const read = async (from: string) => {
    const init = { redirect: 'manual', signal: AbortSignal.timeout(readMs) } as const;
    const up = await fetcher(`${from}${AS_PATH}`, init).catch(() => undefined);
    const body = up?.ok ? await up.text().catch(() => '') : '';
    if (!issuerIn(body)) throw unavailable('the authorization server did not answer');
    return { at: now(), body };
  };
  return async (req, res, next) => {
    if (req.method !== 'GET' || req.path !== AS_PATH) return next();
    if (!issuer) throw unavailable('no authorization server is set on this host');
    if (!cached || now() - cached.at >= TTL_MS)
      cached = await (inFlight ??= read(issuer).finally(() => (inFlight = undefined)));
    res.writeHead(200, ANSWER).end(cached.body);
  };
};
