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

// Only the route itself answers a 2xx, or an envelope on 400 or 422 (as the logs client, #114).
const OWN_4XX = new Set([400, 422]);
const routeOwned = ({ res, body }: Answer) =>
  res.ok || (OWN_4XX.has(res.status) && EnvelopeSchema.safeParse(body).success);

// A missing base (404), or an edge of a v13 host that answers before routing (401, 403).
const FOREIGN = new Set([401, 403, 404]);

const otherBase = (t: ApiTarget, base: string): string | undefined =>
  base !== LEGACY ? LEGACY : t.id ? `/api/${t.id}` : undefined;

// A foreign answer on an unpinned base, or a 404 on a pinned one (the host moved), tries the other base once.
const reach = async (t: ApiTarget, path: string, init: RequestInit): Promise<Answer> => {
  const pinned = t.bases.pinned;
  const first = pinned ?? (t.id ? `/api/${t.id}` : LEGACY);
  const answer = await ask(t, `${first}${path}`, init);
  if (routeOwned(answer)) t.bases.pinned = first;
  const second = otherBase(t, first);
  const status = answer.res.status;
  if (!second || (pinned ? status !== 404 : !FOREIGN.has(status))) return answer;
  delete t.bases.pinned;
  const other = await ask(t, `${second}${path}`, init);
  if (routeOwned(other)) t.bases.pinned = second;
  return FOREIGN.has(other.res.status) ? answer : other;
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
