import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LaunchSpec {
  id: string;
  dir: string;
  dataDir: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
}

// A started extension: its loopback port; stop drains it (SIGTERM) and waits for the exit.
export interface Child {
  port: number;
  exited: Promise<void>;
  stop(): Promise<void>;
}

export type Launch = (spec: LaunchSpec) => Promise<Child>;

export const HOST_MAIN = fileURLToPath(new URL('../main.js', import.meta.url));
const START_MS = 60_000;
const STOP_MS = 15_000;
const PASSED = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'NODE_EXTRA_CA_CERTS'];

// Handed over as 0600 files in a 0700 folder, removed once the child has read them.
const secretFiles = async (spec: LaunchSpec): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `agentage-${spec.id}-`));
  for (const [name, value] of Object.entries(spec.secrets))
    await writeFile(join(dir, name), value, { mode: 0o600 });
  return dir;
};

const envOf = (spec: LaunchSpec, secretsDir: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(PASSED.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : []))),
  PORT: '0',
  AGENTAGE_EXTENSION_DIR: spec.dir,
  AGENTAGE_DATA_DIR: spec.dataDir,
  AGENTAGE_SETTINGS: JSON.stringify(spec.settings),
  AGENTAGE_SECRETS_DIR: secretsDir,
});

// The child's last stderr line, its msg when it is a log row: why it did not start.
const lastWords = (tail: string, code: number | null): string => {
  const line = tail.trim().split('\n').at(-1) ?? '';
  try {
    return String((JSON.parse(line) as { msg?: unknown }).msg ?? line);
  } catch {
    return line || `exited with code ${code}`;
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

const portOf = (msg: unknown): number | undefined => {
  const { type, port } = (msg ?? {}) as { type?: unknown; port?: unknown };
  return type === 'ready' && typeof port === 'number' ? port : undefined;
};

// The port the child bound, or why it exited first; a child silent for START_MS is killed.
const readyOf = (child: ChildProcess, tail: () => string): Promise<number> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), START_MS);
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    child.on('message', (msg) => {
      const port = portOf(msg);
      if (port) settle(() => resolve(port));
    });
    child.once('exit', (code) => settle(() => reject(new Error(lastWords(tail(), code)))));
  });

const stopOf = (child: ChildProcess, exited: Promise<void>) => async () => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), STOP_MS);
  await exited;
  clearTimeout(kill);
};

// One child process per extension: node dist/host/main.js on a port the OS picks.
export const forkLaunch =
  (main = HOST_MAIN): Launch =>
  async (spec) => {
    const secretsDir = await secretFiles(spec);
    const stdio = ['ignore', 'pipe', 'pipe', 'ipc'] as const;
    const child = fork(main, [], { env: envOf(spec, secretsDir), stdio: [...stdio] });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      const port = await readyOf(child, captured(child));
      return { port, exited, stop: stopOf(child, exited) };
    } finally {
      await rm(secretsDir, { recursive: true, force: true });
    }
  };
