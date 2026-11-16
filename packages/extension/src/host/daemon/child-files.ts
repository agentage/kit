import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { secretNames } from '../../manifest/parts.js';
import { SecretNameSchema } from '../../manifest/primitives.schema.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { clearOldLock } from '../data-lock.js';
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
  // The folders this launch made (run/{id}, data/{id}), so a first start that fails leaves none.
  made: { run: boolean; data: boolean };
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
  const run = await mkdir(runDir, { recursive: true, mode: 0o700 });
  const data = await mkdir(spec.dataDir, { recursive: true }).catch(async (err: unknown) => {
    if (run !== undefined) await rm(runDir, { recursive: true, force: true });
    throw err;
  });
  const made = { run: run !== undefined, data: data !== undefined };
  return { runDir, secretsDir: join(runDir, 'secrets'), tmpDir: join(runDir, 'tmp'), made };
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

// A child that never reported its port: what this launch made goes; data/{id} only while empty.
export const undoRun = async ({ runDir, made }: RunFolders, dataDir: string): Promise<void> => {
  if (made.run) await rm(runDir, { recursive: true, force: true });
  if (made.data) await rmdir(dataDir).catch(() => undefined);
};
