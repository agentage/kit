import { z } from 'zod';
import { authDown } from './auth-answer.js';
import { type Credential } from './cloud-credentials.js';
import { type SessionUser } from './session.js';

// The identity reads of auth that need no extension id: the cookie session, the OAuth bearer.
const COOKIE_READ = '/api/auth/get-session';
const BEARER_READ = '/api/auth/mcp/get-session';

export interface IdentityOptions {
  issuer: string;
  fetcher: typeof fetch;
  timeoutMs: number;
}

// The user and the time the session ends (ms), if auth sent one; null when signed out.
export type Seen = { user: SessionUser; ends?: number } | null;

const CookieSchema = z
  .object({
    user: z.object({ id: z.string().min(1), email: z.string().nullish() }),
    session: z.object({ expiresAt: z.string().optional() }).optional(),
  })
  .nullable();

const BearerSchema = z
  .object({
    userId: z.string().min(1),
    clientId: z.string().nullish(),
    accessTokenExpiresAt: z.string().optional(),
  })
  .nullable();

const endsOf = (at: string | undefined) => {
  const ends = Date.parse(at ?? '');
  return Number.isNaN(ends) ? {} : { ends };
};

const parsed = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) throw authDown('auth sent a session this host cannot read');
  return result.data;
};

const cookieSeen = (body: unknown): Seen => {
  const data = parsed(CookieSchema, body);
  if (!data) return null;
  const { id, email } = data.user;
  return { user: { id, ...(email && { email }) }, ...endsOf(data.session?.expiresAt) };
};

// A PAT is never a sign-in, the rule of the auth exchange.
const bearerSeen = (body: unknown): Seen => {
  const data = parsed(BearerSchema, body);
  if (!data || data.clientId?.startsWith('pat:')) return null;
  return { user: { id: data.userId }, ...endsOf(data.accessTokenExpiresAt) };
};

const get = (options: IdentityOptions, credential: Credential) =>
  options
    .fetcher(`${options.issuer}${'cookie' in credential ? COOKIE_READ : BEARER_READ}`, {
      headers: { ...credential },
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: 'error',
    })
    .catch(() => {
      throw authDown('auth is unreachable');
    });

// One read at auth: 200 the user or null, 429 or 5xx down, any other status signed out.
export const askIdentity = async (
  options: IdentityOptions,
  credential: Credential
): Promise<Seen> => {
  const res = await get(options, credential);
  if (res.status !== 200) void res.body?.cancel().catch(() => undefined);
  if (res.status === 429 || res.status >= 500) throw authDown('auth cannot read the session now');
  if (res.status !== 200) return null;
  const body: unknown = await res.json().catch(() => undefined);
  return 'cookie' in credential ? cookieSeen(body) : bearerSeen(body);
};
