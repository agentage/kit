import { hostError } from './host-error.js';
import { type FetchLike, type TokenSource } from './host.types.js';
import { EnvelopeSchema } from './rpc.schema.js';
import { timedOut, withTimeout } from './timeout.js';

// The bridge's extension: every api call goes to /api/{id}{path} on its host.
export interface ApiTarget {
  fetch: FetchLike;
  token: TokenSource;
  id: string;
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

export const callApi = async (t: ApiTarget, path: string, init?: RequestInit): Promise<unknown> => {
  if (!path.startsWith('/')) throw hostError('BAD_PATH', `api path must start with /: ${path}`);
  const { res, body } = await ask(t, `/api/${t.id}${path}`, withAuth(init, await t.token()));
  const envelope = EnvelopeSchema.safeParse(body);
  if (!envelope.success) throw hostError(`HTTP_${res.status}`, `api answered ${res.status}`);
  if (!envelope.data.success)
    throw hostError(envelope.data.error.code, envelope.data.error.message);
  return envelope.data.data;
};
