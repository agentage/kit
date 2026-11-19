import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  secretNames,
  SecretNameSchema,
  readManifest,
  clearOldLock,
} from '@agentage/extension/internal';
import { runDirOf } from './daemon-files.js';
import { clearRunLock } from './run-lock.js';

interface RunSpec {
  id: string;
  dir: string;
  dataDir: string;
  secrets: Record<string, string>;
}

export interface RunFolders {
  runDir: string;
  secretsDir: string;
  tmpDir: string;
  // The first folder this launch made up to run/{id}, and data/{id}: a failed first start leaves none.
  made: { run?: string; data: boolean };
}

// The supervisor's dataDir is <configDir>/data/{id}, so run/{id} sits beside data/ (C2).
export const configDirOf = (dataDir: string): string => dirname(dirname(dataDir));

// Only the names the package declares now: a row can still hold one an older version declared.
const declared = async (spec: RunSpec): Promise<[string, string][]> => {
  const names = new Set(secretNames(await readManifest(spec.dir)));
  return Object.entries(spec.secrets).filter(([name]) => names.has(name));
};

// The folders first, so undoRun knows what this launch made; data/{id} before the fork (PGlite).
export const makeRun = async (spec: RunSpec): Promise<RunFolders> => {
  const runDir = runDirOf(configDirOf(spec.dataDir), spec.id);
  const made = { run: await mkdir(runDir, { recursive: true, mode: 0o700 }), data: false };
  const run = { runDir, secretsDir: join(runDir, 'secrets'), tmpDir: join(runDir, 'tmp'), made };
  const data = await mkdir(spec.dataDir, { recursive: true }).catch(async (err: unknown) => {
    await undoRun(run, spec.dataDir);
    throw err;
  });
  made.data = data !== undefined;
  return run;
};

// Fresh secrets and tmp; the old lock beside data/{id} and a left-over run lock are cleared.
export const fillRun = async (run: RunFolders, spec: RunSpec): Promise<void> => {
  for (const dir of [run.secretsDir, run.tmpDir]) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { mode: 0o700 });
  }
  await clearOldLock(`${spec.dataDir}.lock`);
  await clearRunLock(join(run.runDir, 'store.lock'), run.runDir);
  for (const [name, value] of await declared(spec))
    await writeFile(join(run.secretsDir, SecretNameSchema.parse(name)), value, { mode: 0o600 });
};

// From dir up to top, each folder only while it is empty: rmdir refuses one that is not.
const emptyUpTo = async (dir: string, top: string): Promise<void> => {
  for (; dir.startsWith(top); dir = dirname(dir)) if (await rmdir(dir).catch(() => 'kept')) return;
};

// A child that never reported its port: what this launch made goes, run/ only while empty.
export const undoRun = async ({ runDir, made }: RunFolders, dataDir: string): Promise<void> => {
  if (made.run) await rm(runDir, { recursive: true, force: true });
  if (made.run) await emptyUpTo(dirname(runDir), made.run);
  if (made.data) await rmdir(dataDir).catch(() => undefined);
};
