import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecretNameSchema } from '../../manifest/primitives.schema.js';
import { CLOCK_RATE_ENV, parseClockRate } from '../../worker/clock.js';
import { LIMITS } from './limits.js';

interface LaunchSpec {
  id: string;
  dir: string;
  dataDir: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
  origin: string;
  // The daemon's own health limit (healthMs), so one rule bounds the child's store open.
  storeOpenMs?: number;
}

export interface Exit {
  code: number | null;
  signal: string | null;
  // The last stderr line (its msg when a log row): the reason a restart and failed show.
  words?: string;
}

// A started extension: its loopback port; stop drains it (SIGTERM) and waits for the exit.
export interface Child {
  port: number;
  pid: number;
  exited: Promise<Exit>;
  stop(): Promise<void>;
}

// clockRate: the test clock every child gets (C5); /health of the daemon shows the same value.
export type Launch = ((spec: LaunchSpec) => Promise<Child>) & { clockRate?: number };

const HOST_MAIN = fileURLToPath(new URL('../main.js', import.meta.url));
const STOP_MS = 5_000;
const PASSED = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'NODE_EXTRA_CA_CERTS'];

// Handed over as 0600 files in a 0700 folder, removed once the child has read them.
const secretFiles = async (spec: LaunchSpec): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `agentage-${spec.id}-`));
  for (const [name, value] of Object.entries(spec.secrets))
    await writeFile(join(dir, SecretNameSchema.parse(name)), value, { mode: 0o600 });
  return dir;
};

// What dist/host/main.js reads (docs/part-image.md), on a port the OS picks.
export const childEnv = (spec: LaunchSpec, secretsDir: string): Record<string, string> => ({
  PORT: '0',
  AGENTAGE_EXTENSION_DIR: spec.dir,
  AGENTAGE_DATA_DIR: spec.dataDir,
  AGENTAGE_SETTINGS: JSON.stringify(spec.settings),
  AGENTAGE_SECRETS_DIR: secretsDir,
  AGENTAGE_ORIGIN: spec.origin,
  ...(spec.storeOpenMs && { AGENTAGE_STORE_OPEN_MS: String(spec.storeOpenMs) }),
});

const passedEnv = () =>
  Object.fromEntries(PASSED.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])));

// The child's last stderr line, its msg when it is a log row: why it did not start.
const lastWords = (tail: string, how: Exit): string => {
  const lines = tail
    .trim()
    .split('\n')
    .filter((l) => !/^Node\.js v\d/.test(l));
  const line = lines.at(-1) ?? '';
  try {
    const msg = String((JSON.parse(line) as { msg?: unknown }).msg ?? line);
    return msg.replace(/^[A-Za-z]*Error: /, '');
  } catch {
    return line || `exited with ${how.signal ? `signal ${how.signal}` : `code ${how.code}`}`;
  }
};

const captured = (child: ChildProcess): (() => string) => {
  let tail = '';
  child.stdout?.pipe(process.stdout);
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
    tail = (tail + chunk.toString()).slice(-4000);
  });
  return () => tail;
};

// 'exit' can come before the last stderr chunk: wait for the stream end, at most 500 ms.
const flushed = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (!child.stderr || child.stderr.readableEnded) return resolve();
    child.stderr.once('end', resolve);
    setTimeout(resolve, 500).unref();
  });

// A log row below error (listening, a request, a warning) is not why a running child exited.
const loud = (tail: string): string =>
  tail
    .split('\n')
    .filter((line) => !/^\{.*"level":"(warn|info|debug|trace)"/.test(line))
    .join('\n');

const exitOf = (child: ChildProcess, tail: () => string): Promise<Exit> =>
  new Promise((resolve) =>
    child.once('exit', (code, signal) => {
      const how = { code, signal };
      void flushed(child).then(() => resolve({ ...how, words: lastWords(loud(tail()), how) }));
    })
  );

const portOf = (msg: unknown): number | undefined => {
  const { type, port } = (msg ?? {}) as { type?: unknown; port?: unknown };
  return type === 'ready' && typeof port === 'number' ? port : undefined;
};

// The port the child bound, or why it exited first; a child silent for startMs is killed.
const readyOf = (child: ChildProcess, tail: () => string, startMs: number): Promise<number> =>
  new Promise((resolve, reject) => {
    let killed = false;
    const timer = setTimeout(() => ((killed = true), child.kill('SIGKILL')), startMs);
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    child.on('message', (msg) => {
      const port = portOf(msg);
      if (port) settle(() => resolve(port));
    });
    child.once('exit', (code, signal) => {
      const why = killed
        ? `reported no port in ${startMs} ms: killed`
        : lastWords(tail(), { code, signal });
      settle(() => reject(new Error(why)));
    });
  });

// SIGTERM drains; a child still there after STOP_MS (a request that never ends) gets SIGKILL.
const stopOf = (child: ChildProcess, exited: Promise<Exit>) => async () => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), STOP_MS);
  await exited;
  clearTimeout(kill);
};

// One child process per extension: node dist/host/main.js on a port the OS picks.
export const forkLaunch = (main = HOST_MAIN, startMs = LIMITS.startMs, rate?: number): Launch => {
  const clockRate = parseClockRate(rate);
  const launch = async (spec: LaunchSpec): Promise<Child> => {
    const secretsDir = await secretFiles(spec);
    const stdio = ['ignore', 'pipe', 'pipe', 'ipc'] as const;
    // execArgv []: the daemon's own node flags (a loader, --input-type) are not the child's.
    const clock = clockRate === 1 ? {} : { [CLOCK_RATE_ENV]: String(clockRate) };
    const env = { ...passedEnv(), ...childEnv(spec, secretsDir), ...clock };
    const child = fork(main, [], { env, execArgv: [], stdio: [...stdio] });
    const tail = captured(child);
    const exited = exitOf(child, tail);
    try {
      const port = await readyOf(child, tail, startMs);
      return { port, pid: child.pid ?? 0, exited, stop: stopOf(child, exited) };
    } finally {
      await rm(secretsDir, { recursive: true, force: true });
    }
  };
  return Object.assign(launch, { clockRate });
};
