import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { type Exit, type LaunchSpec } from './child.js';
import { portOf, type Run, type Runner, type RunState } from './runner.js';

// An origin only: scheme, host and port; no user, password, path, query or fragment.
const ORIGIN = /^https?:\/\/[^/?#@]+$/;

// One row of an app host's upstreams.json (agentage/apphosts): a running service of one extension.
export const UpstreamSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  service: z.string().min(1),
  address: z.url({ protocol: /^https?$/ }).regex(ORIGIN, 'an upstream address is an origin only'),
});
export const UpstreamListSchema = z.array(UpstreamSchema);
export type Upstream = z.infer<typeof UpstreamSchema>;

export const readUpstreams = async (file: string): Promise<Upstream[]> =>
  UpstreamListSchema.parse(JSON.parse(await readFile(file, 'utf8')));

export interface UpstreamOptions {
  upstreams: Upstream[];
  intervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
type Options = Required<UpstreamOptions>;

// Every row of an id (api and pages are two services), in list order: the first answer wins.
const rowsOf = (upstreams: Upstream[], id: string): Upstream[] => {
  const rows = upstreams.filter((row) => row.id === id);
  if (!rows.length) throw new Error(`no upstream for ${id} in the upstream list`);
  return rows;
};

// One health probe; any failure (status, refusal, timeout) is down, never a throw.
const probe = async (address: string, opts: Options): Promise<RunState> => {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const res = await opts.fetch(`${address}/health`, { signal }).catch(() => undefined);
  await res?.body?.cancel().catch(() => undefined);
  return res?.status === 200 ? 'running' : 'down';
};

// The health of one row: at most one probe in flight, also when intervalMs < timeoutMs.
const rowWatch = (address: string, opts: Options) => {
  let state: RunState = 'down';
  let inFlight: Promise<void> | undefined;
  const tick = () =>
    (inFlight ??= probe(address, opts)
      .then((next) => void (state = next))
      .finally(() => (inFlight = undefined)));
  return { tick, state: () => state };
};

const watch = async (rows: Upstream[], opts: Options): Promise<Run> => {
  const watches = rows.map((row) => rowWatch(row.address, opts));
  const tick = () => Promise.all(watches.map((w) => w.tick()));
  await tick();
  let stopped = false;
  const { promise: exited, resolve: done } = Promise.withResolvers<Exit>();
  const timer = setInterval(() => void tick(), opts.intervalMs).unref();
  // As the stub: an id with any row that answers is up.
  const up = () => watches.some((w) => w.state() === 'running');
  const [first] = rows as [Upstream, ...Upstream[]];
  return {
    // No local process: the service runs in its own container.
    pid: 0,
    port: portOf(first.address),
    exited,
    address: () => first.address,
    addresses: () => rows.map((row) => row.address),
    state: () => (stopped ? 'exited' : up() ? 'running' : 'down'),
    stop: async () => {
      clearInterval(timer);
      stopped = true;
      done({ code: null, signal: null });
    },
  };
};

// The upstream runner (J.4.4 row 1): it starts nothing; it connects to listed addresses and watches health.
export const upstreamRunner = (options: UpstreamOptions): Runner => {
  const opts = { intervalMs: 5_000, timeoutMs: 2_000, fetch: globalThis.fetch, ...options };
  return {
    kind: 'upstream',
    start: async (spec: Pick<LaunchSpec, 'id'>) => watch(rowsOf(opts.upstreams, spec.id), opts),
  };
};
