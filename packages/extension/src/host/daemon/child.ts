import { fork, type ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOCK_RATE_ENV, parseClockRate } from '../../worker/clock.js';
import { fillRun, makeRun, undoRun, type RunFolders } from './child-files.js';
import { lastWords } from './last-words.js';
import { LIMITS } from './limits.js';
import { redactedLines } from './redact-stream.js';
import { permissionFlag, sealFlags, sealOf, type Seal } from './seal.js';

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

// clockRate: the test clock every child gets (C5); seal: whether each child runs sealed on node (C2).
export type Launch = ((spec: LaunchSpec) => Promise<Child>) & {
  clockRate?: number;
  seal?: Seal;
  node?: string;
};

const HOST_MAIN = fileURLToPath(new URL('../main.js', import.meta.url));
const STOP_MS = 5_000;
const PASSED = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'NODE_EXTRA_CA_CERTS'];

// What dist/host/main.js reads (docs/part-image.md), on a port the OS picks.
export const childEnv = (
  spec: LaunchSpec,
  secretsDir: string,
  runDir?: string
): Record<string, string> => ({
  PORT: '0',
  AGENTAGE_EXTENSION_DIR: spec.dir,
  AGENTAGE_DATA_DIR: spec.dataDir,
  AGENTAGE_SETTINGS: JSON.stringify(spec.settings),
  AGENTAGE_SECRETS_DIR: secretsDir,
  AGENTAGE_ORIGIN: spec.origin,
  ...(runDir && { AGENTAGE_RUN_DIR: runDir }),
  ...(spec.storeOpenMs && { AGENTAGE_STORE_OPEN_MS: String(spec.storeOpenMs) }),
});

export { lastWords } from './last-words.js';

const passedEnv = () =>
  Object.fromEntries(PASSED.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])));

const captured = (child: ChildProcess, secrets: Record<string, string>): (() => string) => {
  let tail = '';
  const out = redactedLines((text) => process.stderr.write(text), secrets);
  child.stdout?.pipe(process.stdout);
  child.stderr?.on('data', (chunk: Buffer) => {
    out(chunk.toString());
    tail = (tail + chunk.toString()).slice(-4000);
  });
  child.stderr?.once('end', () => out());
  return () => tail;
};

// 'exit' can come before the last stderr chunk: wait for the stream end, at most 500 ms.
const flushed = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (!child.stderr || child.stderr.readableEnded) return resolve();
    child.stderr.once('end', resolve);
    setTimeout(resolve, 500).unref();
  });

const exitOf = (child: ChildProcess, tail: () => string): Promise<Exit> =>
  new Promise((resolve) =>
    child.once('exit', (code, signal) => {
      const how = { code, signal };
      void flushed(child).then(() => resolve({ ...how, words: lastWords(tail(), how) }));
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

// The daemon's own node flags (a loader, --input-type) are never the child's; C2 where Node has --permission.
const execArgvOf = (node: string, main: string, spec: LaunchSpec, run: RunFolders) => {
  if (!permissionFlag(node)) return [];
  const configDir = dirname(dirname(spec.dataDir));
  const { id, dir, dataDir } = spec;
  return sealFlags({ id, main, dir, configDir, runDir: run.runDir, dataDir });
};

// The listed env of the daemon, then the child's own: TMPDIR in run/{id}, the test clock when not 1.
const envOf = (spec: LaunchSpec, run: RunFolders, clockRate: number) => ({
  ...passedEnv(),
  ...childEnv(spec, run.secretsDir, run.runDir),
  TMPDIR: run.tmpDir,
  ...(clockRate === 1 ? {} : { [CLOCK_RATE_ENV]: String(clockRate) }),
});

interface ForkAt {
  main: string;
  startMs: number;
  clockRate: number;
  node: string;
}

const started = async (at: ForkAt, spec: LaunchSpec, run: RunFolders): Promise<Child> => {
  const execArgv = execArgvOf(at.node, at.main, spec, run);
  await fillRun(run, spec);
  const stdio = ['ignore', 'pipe', 'pipe', 'ipc'] as const;
  const child = fork(at.main, [], {
    env: envOf(spec, run, at.clockRate),
    execArgv,
    stdio: [...stdio],
  });
  const tail = captured(child, spec.secrets);
  const exited = exitOf(child, tail);
  const port = await readyOf(child, tail, at.startMs);
  return { port, pid: child.pid ?? 0, exited, stop: stopOf(child, exited) };
};

// Anything before the port (files, the seal check, the start) undoes the folders this launch made.
const launchAt =
  (at: ForkAt) =>
  async (spec: LaunchSpec): Promise<Child> => {
    const run = await makeRun(spec);
    try {
      return await started(at, spec, run);
    } catch (err) {
      await undoRun(run, spec.dataDir);
      throw err;
    } finally {
      await rm(run.secretsDir, { recursive: true, force: true });
    }
  };

// One child process per extension on a port the OS picks; node: the version the seal gate reads.
export const forkLaunch = (
  main = HOST_MAIN,
  startMs = LIMITS.startMs,
  rate?: number,
  node = process.versions.node
): Launch => {
  const clockRate = parseClockRate(rate);
  const launch = launchAt({ main, startMs, clockRate, node });
  return Object.assign(launch, { clockRate, seal: sealOf(node), node });
};
