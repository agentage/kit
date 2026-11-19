import { z } from 'zod';
import { fail } from '@agentage/extension/internal';
import { type Credential } from './cloud-credentials.js';
import { type SessionUser } from './session.js';

export type Access = 'read' | 'write' | 'admin';

export interface ExchangeAnswer {
  token: string;
  user: SessionUser;
  expiresAt: string;
}

// The token of one extension: null when signed out, false when auth refused the access (403).
export type Outcome = ExchangeAnswer | null | false;

export interface AskOptions {
  issuer: string;
  fetcher: typeof fetch;
  timeoutMs: number;
}

const AnswerSchema = z.object({
  data: z.object({
    token: z.string().min(1),
    user: z.object({ id: z.string().min(1), email: z.string().optional() }),
    expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  }),
});

// An outage is a 503, never a 401: a signed-in user must not look signed out.
export const authDown = (message: string) => fail('UNAVAILABLE', message, { retryAfter: 5 });

const answerOf = async (res: Response): Promise<ExchangeAnswer> => {
  const body: unknown = await res.json().catch(() => undefined);
  const parsed = AnswerSchema.safeParse(body);
  if (!parsed.success) throw authDown('auth sent an answer this host cannot read');
  const { token, user, expiresAt } = parsed.data.data;
  return { token, expiresAt, user: { id: user.id, ...(user.email && { email: user.email }) } };
};

const post = (options: AskOptions, credential: Credential, id: string, access: Access) =>
  options
    .fetcher(`${options.issuer}/account/extension-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...credential },
      body: JSON.stringify({ extension: id, access }),
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    .catch(() => {
      throw authDown('auth is unreachable');
    });

// One exchange at auth: 201 the token, 403 refused, 429 or 5xx down, any other status signed out.
export const askAuth = async (
  options: AskOptions,
  credential: Credential,
  id: string,
  access: Access
): Promise<Outcome> => {
  const res = await post(options, credential, id, access);
  if (res.status === 201) return answerOf(res);
  // The body of any other status is not read: free the connection.
  void res.body?.cancel().catch(() => undefined);
  if (res.status === 403) return false;
  if (res.status === 429 || res.status >= 500) throw authDown('auth cannot exchange now');
  return null;
};
