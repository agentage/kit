import { rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonFile, withFileLock, writeJsonFile } from './json-file.js';

const DAEMON_FILE = 'daemon.json';
export const DAEMON_PROTOCOL = 1;

interface DaemonFile {
  pid: number;
  port: number;
  version: string;
  protocol: number;
  startedBy: string;
}

export const writeDaemonFile = (configDir: string, file: DaemonFile): Promise<void> =>
  writeJsonFile(join(configDir, DAEMON_FILE), file);

export const removeDaemonFile = (configDir: string): Promise<void> =>
  unlink(join(configDir, DAEMON_FILE)).catch(() => undefined);

export const dataDirOf = (configDir: string, id: string): string => join(configDir, 'data', id);

export const purgeData = (configDir: string, id: string): Promise<void> =>
  rm(dataDirOf(configDir, id), { recursive: true, force: true });

// Settings and secrets by extension id; secrets.json is 0600 and no route ever returns it.
type ValueKind = 'settings' | 'secrets';
type Values = Record<string, unknown>;

const fileOf = (configDir: string, kind: ValueKind) => join(configDir, `${kind}.json`);

export const readValues = async (configDir: string, kind: ValueKind, id: string) =>
  (await readJsonFile<Record<string, Values>>(fileOf(configDir, kind), {}))[id] ?? {};

type Rows = Record<string, Values>;

// The rows of one file changed under its lock; the same object back writes nothing.
const changeValues = (
  configDir: string,
  kind: ValueKind,
  change: (all: Rows) => Rows,
  waitMs?: number
) => {
  const file = fileOf(configDir, kind);
  const write = async () => {
    const all = await readJsonFile<Rows>(file, {});
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
