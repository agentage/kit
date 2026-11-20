import { createHash } from 'node:crypto';
import { fail } from '@agentage/extension/internal';
import {
  type Access,
  askAuth,
  type AskOptions,
  type ExchangeAnswer,
  type Outcome,
} from './auth-answer.js';
import { type Credential } from './cloud-credentials.js';

const MINUTE_MS = 60_000;
const EARLY_MS = 30_000;
const SIGNED_OUT_MS = 30_000;
// An admin refusal lasts about as long as a write token, so a non-admin probes admin once per token.
const REFUSED_MS = 240_000;
const EXCHANGE_MS = 5000;
const MAX_CACHED = 5000;

export type AddressLimit = (address: string) => boolean;

// allow(address): false over `max` exchanges at auth per address in a minute.
export const createAddressLimit = (max = 30, now = Date.now): AddressLimit => {
  const seen = new Map<string, { start: number; n: number }>();
  return (address) => {
    const hit = seen.get(address);
    if (hit && now() - hit.start < MINUTE_MS) return ++hit.n <= max;
    if (seen.size >= MAX_CACHED) seen.clear();
    seen.set(address, { start: now(), n: 1 });
    return true;
  };
};

// The session token value alone: a rotated data cookie or an added cookie must hit the same entry.
const TOKEN = /^(?:__Secure-|__Host-)?better-auth[.-]session_token=(.*)$/;

const secretOf = (credential: Credential): string => {
  if (!('cookie' in credential)) return credential.authorization;
  const parts = credential.cookie.split(';').map((part) => TOKEN.exec(part.trim())?.[1]);
  const tokens = new Set(parts.filter((token) => token !== undefined));
  // Two different tokens (a planted twin from a sibling host): the whole string.
  return tokens.size === 1 ? [...tokens][0]! : credential.cookie;
};

export const keyOf = (credential: Credential, id: string) =>
  `${createHash('sha256').update(secretOf(credential)).digest('hex')}:${id}`;

const untilOf = (data: Outcome, now: number) => {
  if (data) return Date.parse(data.expiresAt) - EARLY_MS;
  return now + (data === false ? REFUSED_MS : SIGNED_OUT_MS);
};

export interface ExchangeOptions {
  issuer: string;
  fetcher?: typeof fetch;
  now?: () => number;
  allow?: AddressLimit;
  timeoutMs?: number;
}

export interface Exchange {
  (
    credential: Credential,
    id: string,
    access: Access | Access[],
    address?: string
  ): Promise<ExchangeAnswer | null>;
  // Every id and access of one credential, also in flight: a signed-out cookie keeps no token.
  forget(credential: Credential): void;
}

interface Entry {
  data: Promise<Outcome>;
  until: number;
}

interface Cache {
  entries: Map<string, Entry>;
  now: () => number;
  ask: AskOptions;
}

type Pay = () => boolean;
type One = (credential: Credential, id: string, access: Access, pay: Pay) => Promise<Outcome>;

const cacheOf = (options: ExchangeOptions): Cache => ({
  entries: new Map(),
  now: options.now ?? Date.now,
  ask: {
    issuer: options.issuer,
    fetcher: options.fetcher ?? fetch,
    timeoutMs: options.timeoutMs ?? EXCHANGE_MS,
  },
});

// A failed exchange leaves no entry: the next call asks auth again.
const settle = async (cache: Cache, key: string, entry: Entry): Promise<Outcome> => {
  const data = await entry.data.catch((err: unknown) => {
    cache.entries.delete(key);
    throw err;
  });
  entry.until = untilOf(data, cache.now());
  return data;
};

const oneOf =
  (cache: Cache): One =>
  async (credential, id, access, pay) => {
    const key = `${keyOf(credential, id)}:${access}`;
    const hit = cache.entries.get(key);
    // In flight or still good: parallel calls of one page share one exchange.
    if (hit && (!hit.until || hit.until > cache.now())) return hit.data;
    // Only a miss costs a call to auth: random cookies from one address cannot use up auth's limit.
    if (!pay()) throw fail('RATE_LIMITED', 'too many sign-in checks');
    if (cache.entries.size >= MAX_CACHED) cache.entries.clear();
    const entry: Entry = { data: askAuth(cache.ask, credential, id, access), until: 0 };
    cache.entries.set(key, entry);
    return settle(cache, key, entry);
  };

// The level list is tried in order; the first answer wins and the list costs one address-limit hit.
const levelsOf =
  (one: One) => async (credential: Credential, id: string, levels: Access[], pay: Pay) => {
    for (const [i, level] of levels.entries()) {
      // A failed admin probe (429, 5xx) must not block a write token that is cached or obtainable.
      const data = await one(credential, id, level, pay).catch((err: unknown) => {
        if (i === levels.length - 1) throw err;
        return false as const;
      });
      if (data) return data;
      // Only a 403 (admin needs an admin account) falls through; a signed-out 401 stops at once.
      if (data === null) return null;
    }
    return null;
  };

// exchange(credential, id, access): auth's token of one extension, cached until 30 s before it ends.
export const createExchange = (options: ExchangeOptions): Exchange => {
  const allow = options.allow ?? (() => true);
  const cache = cacheOf(options);
  const tryLevels = levelsOf(oneOf(cache));
  const exchange = (
    credential: Credential,
    id: string,
    access: Access | Access[],
    address = ''
  ) => {
    let paid: boolean | undefined;
    const pay = () => (paid ??= allow(address));
    return tryLevels(credential, id, [access].flat(), pay);
  };
  const forget = (credential: Credential) => {
    const prefix = keyOf(credential, '');
    for (const key of cache.entries.keys()) if (key.startsWith(prefix)) cache.entries.delete(key);
  };
  return Object.assign(exchange, { forget });
};
