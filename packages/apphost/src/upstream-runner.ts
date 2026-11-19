import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { type Exit, type LaunchSpec } from './child.js';
import { type Run, type Runner, type RunState } from './runner.js';

// One row of an app host's upstreams.json (agentage/apphosts): a running service of one extension.
export const UpstreamSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  service: z.string().min(1),
  address: z.url({ protocol: /^https?$/ }),
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

// An id with two services (api and pages) is served by the one named as the id, else the first.
const rowOf = (upstreams: Upstream[], id: string): Upstream => {
  const rows = upstreams.filter((row) => row.id === id);
  const row = rows.find((r) => r.service === id) ?? rows[0];
  if (!row) throw new Error(`no upstream for ${id} in the upstream list`);
  return row;
};

const portOf = (address: string): number => {
  const url = new URL(address);
  return Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
};

// One health probe; any failure (status, refusal, timeout) is down, never a throw.
const probe = async (address: string, opts: Required<UpstreamOptions>): Promise<RunState> => {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const res = await opts.fetch(`${address}/health`, { signal }).catch(() => undefined);
  await res?.body?.cancel().catch(() => undefined);
  return res?.status === 200 ? 'running' : 'down';
};

const watch = async (row: Upstream, opts: Required<UpstreamOptions>): Promise<Run> => {
  let state: RunState = await probe(row.address, opts);
  const { promise: exited, resolve: done } = Promise.withResolvers<Exit>();
  const tick = () => void probe(row.address, opts).then((n) => state !== 'exited' && (state = n));
  const timer = setInterval(tick, opts.intervalMs).unref();
  return {
    // No local process: the service runs in its own container.
    pid: 0,
    port: portOf(row.address),
    exited,
    address: () => row.address,
    state: () => state,
    stop: async () => {
      clearInterval(timer);
      state = 'exited';
      done({ code: null, signal: null });
    },
  };
};

// The upstream runner (J.4.4 row 1): it starts nothing; it connects to a listed address and watches health.
export const upstreamRunner = (options: UpstreamOptions): Runner => {
  const opts = { intervalMs: 5_000, timeoutMs: 2_000, fetch: globalThis.fetch, ...options };
  return {
    kind: 'upstream',
    start: async (spec: Pick<LaunchSpec, 'id'>) => watch(rowOf(opts.upstreams, spec.id), opts),
  };
};
