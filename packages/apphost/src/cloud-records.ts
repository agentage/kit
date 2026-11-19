import { type RequestHandler } from 'express';
import { fail } from '@agentage/extension/internal';
import { type CloudDiscovery } from './cloud-discovery.js';
import { forwardTo } from './cloud-proxy.js';

// Records under /{id}/ (C4) and the root resource document, from servedBy(id)[0] (stub records.mjs).
export const ROOT_RESOURCE = '/.well-known/oauth-protected-resource';
const PER_ID =
  /^\/([a-z][a-z0-9-]*)(\/\.well-known\/(?:agentage-extension\.json|oauth-protected-resource))$/;
// RFC 9728 metadata of /mcp/{id}: the same path, at the first container that answered for the id.
const MCP_META = /^\/\.well-known\/oauth-protected-resource\/mcp\/([a-z][a-z0-9-]*)$/;
const OPEN = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
const KEYS = ['authorization_servers', 'scopes_supported', 'bearer_methods_supported'] as const;

export interface RecordsOptions {
  fetcher?: typeof fetch | undefined;
  readMs?: number;
  ttlMs?: number;
  now?: () => number;
}

type Doc = Partial<Record<(typeof KEYS)[number], unknown[]>>;
type Discovery = Pick<CloudDiscovery, 'current' | 'servedBy'>;

const publicEntries = (discovery: Discovery) =>
  discovery.current().document.extensions.filter((e) => Object.values(e.expose).includes('public'));

// null: the row has no token check (adds no scope); undefined: no answer (timeout, 5xx, not JSON).
const resourceOf = async (upstream: string | undefined, readMs: number, fetcher: typeof fetch) => {
  if (!upstream) return undefined;
  const init = { redirect: 'manual', signal: AbortSignal.timeout(readMs) } as const;
  const res = await fetcher(new URL(ROOT_RESOURCE, upstream), init).catch(() => undefined);
  if (res?.status === 404) return null;
  if (!res?.ok) return undefined;
  return (await res.json().catch(() => undefined)) as Doc | undefined;
};

const unionOf = (docs: Doc[], key: (typeof KEYS)[number]) => [
  ...new Set(docs.flatMap((d) => (Array.isArray(d[key]) ? d[key] : []))),
];

// One origin, one resource: the scopes of the rows that answer; a slow one drops out; false = 404.
const rootDocument = (discovery: Discovery, own: string, o: RecordsOptions) => {
  const [readMs, ttlMs, now] = [o.readMs ?? 3_000, o.ttlMs ?? 30_000, o.now ?? Date.now];
  const fetcher = o.fetcher ?? fetch;
  let cached: { at: number; body: object | false } | undefined;
  let inFlight: Promise<object | false> | undefined;
  const read = async () => {
    const ids = publicEntries(discovery).map((e) => e.id);
    const first = (id: string) => discovery.servedBy(id)[0];
    const all = await Promise.all(ids.map((id) => resourceOf(first(id), readMs, fetcher)));
    const docs = all.filter((d): d is Doc => Boolean(d));
    const failed = all.includes(undefined);
    if (failed && !docs.length)
      throw fail('UNAVAILABLE', 'no public row gave its resource document', { retryAfter: 5 });
    const keys = KEYS.map((k) => [k, unionOf(docs, k)]);
    const body = docs.length > 0 && { resource: own, ...Object.fromEntries(keys) };
    if (!failed) cached = { at: now(), body };
    return body;
  };
  // Requests that come while a read runs share it.
  return async () =>
    cached && now() - cached.at < ttlMs
      ? cached.body
      : (inFlight ??= read().finally(() => (inFlight = undefined)));
};

// GET only; anything else falls through (on a pages host to the site, as the stub router).
export const recordRoutes = (
  discovery: Discovery,
  own: string,
  o: RecordsOptions = {}
): RequestHandler => {
  const root = rootDocument(discovery, own, o);
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path === ROOT_RESOURCE) {
      const body = await root();
      return body ? void res.set(OPEN).json(body) : next();
    }
    const meta = MCP_META.exec(req.path);
    const match = meta ?? PER_ID.exec(req.path);
    const entry = match && publicEntries(discovery).find((e) => e.id === match[1]);
    if (!match || !entry) return next();
    const { id, state } = entry;
    const [upstream] = discovery.servedBy(id);
    if (!upstream) throw fail('UNAVAILABLE', `${id} is ${state}`, { retryAfter: 5 });
    const path = meta ? req.path : (match[2] as string);
    // A record is anonymous: no token, no auth cookie (upstreamHeaders keeps only a PAT).
    forwardTo(req, res, next, {
      id,
      prefix: path,
      path,
      upstream,
      headers: req.headers,
      answer: OPEN,
    });
  };
};
