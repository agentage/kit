import type { PostEvent, PostResult } from '@agentage/logs';
import { bounded, type Fetch } from './http.js';
import { sendTo } from './logs.js';
import { latestOf, listOf, type Latest, type Listing, type MarketCall } from './market.js';
import {
  CoreFailure,
  fail,
  reasonOf,
  reasonOfError,
  type Answer,
  type CoreReason,
  type CoreService,
} from './reason.js';

// The one env name of the core's address: only this module reads it.
export const CORE_URL_ENV = 'AGENTAGE_CORE_URL';
export const DEFAULT_TIMEOUT_MS = 2_000;

// An origin, or a resolver of one (a discovery read); empty means this machine has no core.
export type CoreUrl = string | undefined | (() => Promise<string>);

export interface CoreClientOptions {
  // Left out: the AGENTAGE_CORE_URL of env.
  url?: CoreUrl;
  env?: Readonly<Record<string, string | undefined>>;
  // The bound of one method call, all its requests together.
  timeoutMs?: number;
  // The bearer of logs.send; the market reads are public.
  token?: string;
  fetch?: Fetch;
  warn?: (message: string) => void;
}

export interface CoreClient {
  market: {
    // data null and down null: the market has no such id (its 404).
    latest: (id: string) => Promise<Answer<Latest | null>>;
    list: () => Promise<Answer<Listing>>;
    // The first reason a market call gave the empty answer; null while none did.
    down: () => CoreReason | null;
  };
  // A failed send is dropped: data null, one warning until a send goes through again.
  logs: {
    send: (events: PostEvent[]) => Promise<Answer<PostResult | null>>;
    down: () => CoreReason | null;
  };
}

export const coreUrlOf = (env: Readonly<Record<string, string | undefined>>): string | undefined =>
  env[CORE_URL_ENV]?.trim() || undefined;

const resolved = async (service: CoreService, url: CoreUrl): Promise<string> => {
  if (!url) return fail(service, 'no_core', 'no core address');
  if (typeof url === 'string') return url;
  return Promise.resolve()
    .then(url)
    .catch((err: unknown) => {
      const why = err instanceof Error ? err.message : String(err);
      throw new CoreFailure(reasonOf(service, 'no_core', `no core address: ${why}`, err));
    });
};

const originOf = async (service: CoreService, url: CoreUrl): Promise<string> => {
  const raw = (await resolved(service, url)).trim();
  if (!URL.canParse(raw)) fail(service, 'no_core', `no core address: ${raw} is not a URL`);
  return new URL(raw).origin;
};

interface State {
  url: CoreUrl;
  fetch: Fetch;
  timeoutMs: number;
  first: Partial<Record<CoreService, CoreReason>>;
}

type Work<T> = (origin: string, signal: AbortSignal) => Promise<T>;

// The boundary: whatever happens in the call, the caller gets an answer before the deadline.
const run = async <T>(
  s: State,
  service: CoreService,
  empty: T,
  work: Work<T>
): Promise<Answer<T>> => {
  const signal = AbortSignal.timeout(s.timeoutMs);
  try {
    const origin = await bounded(originOf(service, s.url), signal);
    return { data: await bounded(work(origin, signal), signal), down: null };
  } catch (err) {
    const down = reasonOfError(service, `the core ${service} (${s.timeoutMs} ms)`, err);
    s.first[service] ??= down;
    return { data: empty, down };
  }
};

const marketOf = (s: State) => {
  const call = (origin: string, signal: AbortSignal): MarketCall => ({
    service: 'market',
    fetch: s.fetch,
    signal,
    origin,
  });
  const why = (err: unknown) => reasonOfError('market', 'the market', err).detail;
  return {
    latest: (id: string) => run(s, 'market', null, (o, sig) => latestOf(call(o, sig), id)),
    list: () =>
      run(s, 'market', { offered: [], skipped: [] }, (o, sig) => listOf(call(o, sig), why)),
    down: () => s.first.market ?? null,
  };
};

// A warn that throws must not turn a dropped send into a rejection.
const safely = (warn: (message: string) => void, message: string) => {
  try {
    warn(message);
  } catch {
    // The warning is lost; the answer still says why.
  }
};

const logsOf = (s: State, o: CoreClientOptions) => {
  const warn = o.warn ?? ((message: string) => console.warn(message));
  let warned = false;
  const send = async (events: PostEvent[]) => {
    const answer = await run(s, 'logs', null, (origin, signal) =>
      sendTo(
        {
          service: 'logs',
          fetch: s.fetch,
          signal,
          origin,
          token: o.token,
          timeoutMs: s.timeoutMs,
        },
        events
      )
    );
    if (answer.down && !warned)
      safely(warn, `${answer.down.message}: ${answer.down.detail}; rows dropped`);
    warned = answer.down !== null;
    return answer;
  };
  return { send, down: () => s.first.logs ?? null };
};

// Never throws, never waits past timeoutMs; caller rules: docs/extension-package.md "The core client".
export const createCoreClient = (o: CoreClientOptions = {}): CoreClient => {
  const s: State = {
    url: o.url ?? coreUrlOf(o.env ?? {}),
    fetch: o.fetch ?? ((input, init) => fetch(input, init)),
    timeoutMs: o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    first: {},
  };
  return { market: marketOf(s), logs: logsOf(s, o) };
};
