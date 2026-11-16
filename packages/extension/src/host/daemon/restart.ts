import { type Exit } from './child.js';
import { type Lane } from './lane.js';
import { type Entry, type SupervisorDeps } from './supervisor.js';

// The restart waiting for its backoff; a halt, a change or a stop clears it.
export interface Retry {
  timer: NodeJS.Timeout;
}

type Again = () => Promise<void>;

// C6: the restarts since the last enable, update, configure or reload (/health reads it).
export const restartsOf = (entry: Entry): number => entry.restarts ?? 0;

export const cancelRestart = (entry: Entry): void => {
  if (entry.retry) clearTimeout(entry.retry.timer);
  entry.retry = undefined;
};

// A new start the owner asked for: the exits and the backoff begin again.
export const resetRestarts = (entry: Entry): void => {
  cancelRestart(entry);
  Object.assign(entry, { exits: [], restarts: 0 });
};

// Healthy for healthyResetMs on the same child: the past exits no longer count.
export const healthyFor = (deps: SupervisorDeps, entry: Entry, lane: Lane): void => {
  const reset = () => entry.lane === lane && Object.assign(entry, { exits: [], restarts: 0 });
  setTimeout(reset, deps.healthyResetMs).unref();
};

export const reasonOf = (how: Exit): string =>
  how.words || `the process exited (${how.signal ? `signal ${how.signal}` : `code ${how.code}`})`;

// The backoff grows with each restart since the reset; the last value repeats.
const delayOf = (deps: SupervisorDeps, restarts: number): number =>
  deps.backoffMs[Math.min(restarts, deps.backoffMs.length - 1)] ?? 0;

const giveUp = (deps: SupervisorDeps, entry: Entry, why: string): void => {
  const min = Math.round(deps.crashWindowMs / 60_000);
  const error = `exited ${deps.crashLimit} times in ${min} min: ${why}`;
  Object.assign(entry, { state: 'failed', error });
  deps.log.warn('extension failed: too many exits', { id: entry.id, reason: why });
};

// In the queue, so it never runs inside a change; a change, remove, reload or stop since cancels it.
const run = async (deps: SupervisorDeps, entry: Entry, retry: Retry, again: Again) => {
  if (entry.retry !== retry || entry.lane || deps.stopping.signal.aborted) return;
  entry.retry = undefined;
  if (entry.install.enabled === false) return;
  entry.restarts = restartsOf(entry) + 1;
  deps.log.info('extension restarts', { id: entry.id, restarts: entry.restarts });
  await again();
};

const schedule = (deps: SupervisorDeps, entry: Entry, ms: number, again: Again): void => {
  const retry = {} as Retry;
  const fire = () => void deps.queue(() => run(deps, entry, retry, again)).catch(() => undefined);
  retry.timer = setTimeout(fire, ms);
  retry.timer.unref();
  entry.retry = retry;
};

// A child that was the route exited (or a restart did not start): restart after the backoff, or failed.
export const crashed = (deps: SupervisorDeps, entry: Entry, why: string, again: Again): void => {
  const now = Date.now();
  const exits = [...(entry.exits ?? []), now].filter((at) => at > now - deps.crashWindowMs);
  entry.exits = exits;
  if (exits.length >= deps.crashLimit) return giveUp(deps, entry, why);
  const ms = delayOf(deps, restartsOf(entry));
  Object.assign(entry, { state: 'starting', error: `${why}: restart in ${ms} ms` });
  deps.log.warn('extension process exited', { id: entry.id, reason: why, restartMs: ms });
  schedule(deps, entry, ms, again);
};
