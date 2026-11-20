import { fail } from '@agentage/extension/internal';
import { type AddressLimit, keyOf } from './auth-exchange.js';
import { askIdentity, type IdentityOptions, type Seen } from './auth-identity.js';
import { type Credential } from './cloud-credentials.js';
import { type SessionUser } from './session.js';

// A signed-in read is kept as long as an exchanged read token was (5 min less 30 s).
const SIGNED_IN_MS = 270_000;
const EARLY_MS = 30_000;
const SIGNED_OUT_MS = 30_000;
const READ_MS = 5000;
const MAX_CACHED = 5000;
const KEY = 'session';

export interface IdentityReadOptions {
  issuer: string;
  fetcher?: typeof fetch;
  now?: () => number;
  allow?: AddressLimit;
  timeoutMs?: number;
}

export interface IdentityRead {
  (credential: Credential, address?: string): Promise<SessionUser | null>;
  // A signed-out cookie keeps no user, also in flight.
  forget(credential: Credential): void;
}

interface Entry {
  data: Promise<Seen>;
  until: number;
}

const untilOf = (seen: Seen, now: number) =>
  seen ? Math.min(now + SIGNED_IN_MS, (seen.ends ?? Infinity) - EARLY_MS) : now + SIGNED_OUT_MS;

// A failed read leaves no entry: the next call asks auth again.
const settle = async (entries: Map<string, Entry>, key: string, entry: Entry, now: number) => {
  const seen = await entry.data.catch((err: unknown) => {
    if (entries.get(key) === entry) entries.delete(key);
    throw err;
  });
  entry.until = untilOf(seen, now);
  return seen;
};

interface Cache {
  entries: Map<string, Entry>;
  now: () => number;
  allow: AddressLimit;
  ask: IdentityOptions;
}

const seenOf =
  ({ entries, now, allow, ask }: Cache) =>
  (credential: Credential, address: string): Promise<Seen> => {
    const key = keyOf(credential, KEY);
    const hit = entries.get(key);
    // In flight or still good: parallel calls of one page share one read.
    if (hit && (!hit.until || hit.until > now())) return hit.data;
    // Only a miss costs a call to auth: random cookies from one address cannot use up auth's limit.
    if (!allow(address)) throw fail('RATE_LIMITED', 'too many sign-in checks');
    if (entries.size >= MAX_CACHED) entries.clear();
    const entry: Entry = { data: askIdentity(ask, credential), until: 0 };
    entries.set(key, entry);
    return settle(entries, key, entry, now());
  };

// read(credential): the auth user of a cookie or a bearer, cached by a hash of the secret.
export const createIdentityRead = (options: IdentityReadOptions): IdentityRead => {
  const cache: Cache = {
    entries: new Map(),
    now: options.now ?? Date.now,
    allow: options.allow ?? (() => true),
    ask: {
      issuer: options.issuer,
      fetcher: options.fetcher ?? fetch,
      timeoutMs: options.timeoutMs ?? READ_MS,
    },
  };
  const seen = seenOf(cache);
  const read = async (credential: Credential, address = '') =>
    (await seen(credential, address))?.user ?? null;
  const forget = (credential: Credential) => void cache.entries.delete(keyOf(credential, KEY));
  return Object.assign(read, { forget });
};
