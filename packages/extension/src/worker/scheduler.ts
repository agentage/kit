import { uuidv7 } from '../agcid/agcid.js';
import { requestScope } from '../agcid/current.js';
import { type HealthCheck } from '../health/health.js';
import { type Log } from '../log/log.js';
import { hostClockRate, parseClockRate, scaledNow } from './clock.js';
import { nextRun, parseCron, type Cron } from './cron.js';
import { JobNameSchema, JobOptionsSchema, toMs, type JobOptions } from './job-options.js';
import { withRunBuffer, type RunBuffer } from './run-log.js';
import { type JobRun, type RunStatus, type RunStore } from './runs.js';

export type Job = () => unknown;

export type Schedule = (name: string, cron: string, job: Job, options?: JobOptions) => void;

interface Entry {
  name: string;
  cron: Cron;
  job: Job;
  timeoutMs?: number;
  nextAt: Date;
  running: boolean;
  timer?: NodeJS.Timeout;
  last?: RunStatus;
  // The current run's start, and whether it already made the job skip a tick.
  runningSince?: Date;
  overran: boolean;
}

export interface SchedulerDeps {
  runs: RunStore;
  log: Log;
  now?: () => Date;
  // The test clock; the default is what the kit host set at boot, else 1. Never read from env here.
  clockRate?: number;
}

export interface Scheduler {
  schedule: Schedule;
  start(): void;
  // No new run; resolves once the runs still going have ended (the caller bounds the wait).
  stop(): Promise<void>;
  run(name: string): Promise<JobRun | undefined>;
  checks(): Record<string, HealthCheck>;
}

interface State {
  deps: SchedulerDeps;
  now: () => Date;
  rate: number;
  entries: Map<string, Entry>;
  started: boolean;
  running: Set<Promise<JobRun>>;
}

// A timer overdue by this much means the process stalled: the job is late.
export const LATE_MS = 60_000;
const MAX_DELAY = 2 ** 31 - 1;

const arm = (s: State, entry: Entry): void => {
  const virtual = Math.max(0, entry.nextAt.getTime() - s.now().getTime());
  const delay = Math.min(MAX_DELAY, Math.ceil(virtual / s.rate));
  entry.timer = setTimeout(() => void fire(s, entry), delay);
};

const fire = async (s: State, entry: Entry): Promise<unknown> => {
  if (!s.started) return undefined;
  if (entry.nextAt.getTime() > s.now().getTime()) return arm(s, entry);
  entry.nextAt = nextRun(entry.cron, s.now());
  arm(s, entry);
  if (!entry.running) return execute(s, entry);
  entry.overran = true;
  s.deps.log.warn('job skipped: its previous run is still running', { job: entry.name });
  return undefined;
};

const newEntry = (
  name: string,
  cron: string,
  job: Job,
  options: JobOptions | undefined,
  at: Date
) => {
  JobNameSchema.parse(name);
  const parsed = parseCron(cron);
  const timeout = JobOptionsSchema.parse(options)?.timeout;
  const nextAt = nextRun(parsed, at);
  const entry: Entry = { name, cron: parsed, job, nextAt, running: false, overran: false };
  if (timeout !== undefined) entry.timeoutMs = toMs(timeout);
  return entry;
};

const runJob = async (entry: Entry, log: Log, buffer: RunBuffer) => {
  try {
    await withRunBuffer(buffer, async () => entry.job());
    return { status: 'ok' as const };
  } catch (err) {
    await withRunBuffer(buffer, async () => log.error(err, { 'agentage.where': entry.name }));
    return { status: 'failed' as const, error: err };
  }
};

// Never twice at once; every run saved with its log, a failed save is logged and the job goes on.
const execute = (s: State, entry: Entry): Promise<JobRun> => {
  const run = requestScope.run({ agcid: uuidv7() }, () => executeScoped(s, entry));
  s.running.add(run);
  const gone = () => void s.running.delete(run);
  run.then(gone, gone);
  return run;
};

// Inside the run's scope: every log line of the job, its failure and its save share one agcid.
const executeScoped = async (s: State, entry: Entry): Promise<JobRun> => {
  const startedAt = s.now();
  Object.assign(entry, { running: true, runningSince: startedAt, overran: false });
  const buffer: RunBuffer = { text: '', truncated: false };
  const { status, error } = await runJob(entry, s.deps.log, buffer);
  entry.running = false;
  entry.last = status;
  const agcid = requestScope.getStore()?.agcid;
  const ms = s.now().getTime() - startedAt.getTime();
  s.deps.log.job({
    name: entry.name,
    runId: agcid ?? '',
    ms,
    ...(error === undefined ? {} : { error }),
  });
  const run: JobRun = { job: entry.name, startedAt, endedAt: s.now(), status, log: buffer.text };
  if (agcid) run.agcid = agcid;
  if (entry.timeoutMs !== undefined) run.timeoutMs = entry.timeoutMs;
  await s.deps.runs.save(run).catch((err: unknown) => s.deps.log.error(err, { job: entry.name }));
  return run;
};

// A run still going past its declared timeout, or one that made the job skip a tick.
const overrunning = (s: State, entry: Entry): boolean => {
  if (!entry.running) return false;
  const ranMs = s.now().getTime() - (entry.runningSince?.getTime() ?? 0);
  return entry.overran || (entry.timeoutMs !== undefined && ranMs > entry.timeoutMs);
};

// ok: the last run ok, the timer on time, no run overrunning; else degraded, never a restart.
const check =
  (s: State, entry: Entry): HealthCheck =>
  async () => {
    const late = s.now().getTime() - entry.nextAt.getTime() > LATE_MS;
    return entry.last === 'failed' || late || overrunning(s, entry) ? 'degraded' : 'ok';
  };

const scheduleOn =
  (s: State): Schedule =>
  (name, cron, job, options) => {
    const entry = newEntry(name, cron, job, options, s.now());
    if (s.entries.has(entry.name)) throw new Error(`job ${name} is scheduled twice`);
    s.entries.set(entry.name, entry);
    if (s.started) arm(s, entry);
  };

const setStarted = (s: State, started: boolean): void => {
  s.started = started;
  for (const entry of s.entries.values()) {
    clearTimeout(entry.timer);
    if (started) arm(s, entry);
  }
};

export const createScheduler = (deps: SchedulerDeps): Scheduler => {
  const rate = parseClockRate(deps.clockRate ?? hostClockRate());
  const s: State = {
    deps,
    now: deps.now ?? scaledNow(rate),
    rate,
    entries: new Map(),
    started: false,
    running: new Set(),
  };
  return {
    schedule: scheduleOn(s),
    start: () => setStarted(s, true),
    stop: async () => {
      setStarted(s, false);
      await Promise.allSettled([...s.running]);
    },
    run: async (name) => {
      const entry = s.entries.get(name);
      return entry && !entry.running ? execute(s, entry) : undefined;
    },
    checks: () =>
      Object.fromEntries([...s.entries.values()].map((e) => [`job:${e.name}`, check(s, e)])),
  };
};
