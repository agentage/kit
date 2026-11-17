import { hostError } from './host-error.js';
import { type FetchLike, type TokenSource } from './host.types.js';
import { EnvelopeSchema } from './rpc.schema.js';
import { timedOut, withTimeout } from './timeout.js';

const LEGACY = '/api/v1';

// The base that answered, per bridge: the daemon serves /api/{id}, a v13 extension host only /api/v1.
export type ApiBases = { pinned?: string };

export interface ApiTarget {
  fetch: FetchLike;
  token: TokenSource;
  // The extension id: no id (one shell host for a deployment) keeps /api/v1.
  id?: string;
  bases: ApiBases;
}

interface Answer {
  res: Response;
  body: unknown;
}

const withAuth = (init: RequestInit | undefined, token: string | undefined): RequestInit => {
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
};

const readJson = async (res: Response): Promise<unknown> => {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
};

const ask = (t: ApiTarget, url: string, init: RequestInit): Promise<Answer> =>
  t
    .fetch(url, withTimeout(init))
    .then(async (res) => ({ res, body: await readJson(res) }))
    .catch(timedOut(url));

// A 2xx or a 4xx other than 404 comes from the route itself; a 404 may be a host with no such base.
const routeOwned = (res: Response) =>
  res.ok || (res.status >= 400 && res.status < 500 && res.status !== 404);

// Tries /api/{id} first; only a 404 there falls back to /api/v1. Both 404: the first answer stands.
const reach = async (t: ApiTarget, path: string, init: RequestInit): Promise<Answer> => {
  const first = t.bases.pinned ?? (t.id ? `/api/${t.id}` : LEGACY);
  const answer = await ask(t, `${first}${path}`, init);
  if (routeOwned(answer.res)) t.bases.pinned = first;
  if (answer.res.status !== 404 || first === LEGACY || t.bases.pinned) return answer;
  const legacy = await ask(t, `${LEGACY}${path}`, init);
  if (routeOwned(legacy.res)) t.bases.pinned = LEGACY;
  return legacy.res.status === 404 ? answer : legacy;
};

export const callApi = async (t: ApiTarget, path: string, init?: RequestInit): Promise<unknown> => {
  if (!path.startsWith('/')) throw hostError('BAD_PATH', `api path must start with /: ${path}`);
  const { res, body } = await reach(t, path, withAuth(init, await t.token()));
  const envelope = EnvelopeSchema.safeParse(body);
  if (!envelope.success) throw hostError(`HTTP_${res.status}`, `api answered ${res.status}`);
  if (!envelope.data.success)
    throw hostError(envelope.data.error.code, envelope.data.error.message);
  return envelope.data.data;
};
