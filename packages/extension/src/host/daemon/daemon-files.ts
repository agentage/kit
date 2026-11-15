import { mkdir, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonFile, withFileLock, writeJsonFile } from './json-file.js';

export const DAEMON_FILE = 'daemon.json';
export const DAEMON_PROTOCOL = 1;

export interface DaemonFile {
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
export type ValueKind = 'settings' | 'secrets';
type Values = Record<string, unknown>;

const fileOf = (configDir: string, kind: ValueKind) => join(configDir, `${kind}.json`);

export const readValues = async (configDir: string, kind: ValueKind, id: string) =>
  (await readJsonFile<Record<string, Values>>(fileOf(configDir, kind), {}))[id] ?? {};

export const writeValues = (configDir: string, kind: ValueKind, id: string, values?: Values) => {
  const file = fileOf(configDir, kind);
  return withFileLock(file, async () => {
    const all = await readJsonFile<Record<string, Values>>(file, {});
    if (values) all[id] = values;
    else delete all[id];
    await writeJsonFile(file, all, kind === 'secrets' ? 0o600 : 0o644);
  });
};

export const ensureConfigDir = (configDir: string) => mkdir(configDir, { recursive: true });
