import { rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from '@agentage/extension/internal';
import { readJsonFile, unreadableReason, withFileLock, writeJsonFile } from './json-file.js';

const DAEMON_FILE = 'daemon.json';
export const DAEMON_PROTOCOL = 1;

interface DaemonFile {
  pid: number;
  port: number;
  version: string;
  protocol: number;
  startedBy: string;
  // D11: the cli sends it on /host/*; the file is 0600 and no child is granted it.
  hostToken: string;
}

export const writeDaemonFile = (configDir: string, file: DaemonFile): Promise<void> =>
  writeJsonFile(join(configDir, DAEMON_FILE), file, 0o600);

export const removeDaemonFile = (configDir: string): Promise<void> =>
  unlink(join(configDir, DAEMON_FILE)).catch(() => undefined);

export const dataDirOf = (configDir: string, id: string): string => join(configDir, 'data', id);

// C2: the folder only this child reads and writes (secrets, TMPDIR, the store lock).
export const runDirOf = (configDir: string, id: string): string => join(configDir, 'run', id);

// No user data in it: removed with the extension; each start makes its secrets and tmp anew.
export const clearRunDir = (configDir: string, id: string): Promise<void> =>
  rm(runDirOf(configDir, id), { recursive: true, force: true });

export const purgeData = (configDir: string, id: string): Promise<void> =>
  rm(dataDirOf(configDir, id), { recursive: true, force: true });

// Settings and secrets by extension id; secrets.json is 0600 and no route ever returns it.
type ValueKind = 'settings' | 'secrets';
type Values = Record<string, unknown>;

const fileOf = (configDir: string, kind: ValueKind) => join(configDir, `${kind}.json`);

type Rows = Record<string, Values>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// A file that is not JSON, or not { id: { name: value } }, is refused by name and never written over.
const unreadable = (kind: ValueKind, reason: string) =>
  fail('CONFLICT', `${kind}.json cannot be read (${reason}): fix it; no change is written`, {
    code: `${kind.toUpperCase()}_UNREADABLE`,
    details: { file: `${kind}.json`, reason },
  });

const rowsOf = async (configDir: string, kind: ValueKind): Promise<Rows> => {
  const all = await readJsonFile<unknown>(fileOf(configDir, kind), {}).catch((err: unknown) => {
    throw unreadable(kind, unreadableReason(err));
  });
  if (!isObject(all) || !Object.values(all).every(isObject))
    throw unreadable(kind, 'not an object of rows by id');
  return all as Rows;
};

export const readValues = async (configDir: string, kind: ValueKind, id: string) =>
  (await rowsOf(configDir, kind))[id] ?? {};

// The rows of one file changed under its lock; the same object back writes nothing.
const changeValues = (
  configDir: string,
  kind: ValueKind,
  change: (all: Rows) => Rows,
  waitMs?: number
) => {
  const file = fileOf(configDir, kind);
  const write = async () => {
    const all = await rowsOf(configDir, kind);
    const next = change(all);
    if (next !== all) await writeJsonFile(file, next, kind === 'secrets' ? 0o600 : 0o644);
  };
  return withFileLock(file, write, waitMs);
};

export const writeValues = (
  configDir: string,
  kind: ValueKind,
  id: string,
  values?: Values,
  waitMs?: number
) =>
  changeValues(
    configDir,
    kind,
    (all) => {
      const rest = { ...all };
      delete rest[id];
      return values ? { ...rest, [id]: values } : rest;
    },
    waitMs
  );
