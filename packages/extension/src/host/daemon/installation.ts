import { join } from 'node:path';
import { readJsonFile, withFileLock, writeJsonFile } from './json-file.js';

// One extension in installation.json (C3): a version, or a source folder; other keys round-trip.
export interface InstallEntry {
  id: string;
  version?: string;
  source?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface Installation {
  host: string;
  extensions: InstallEntry[];
  [key: string]: unknown;
}

export const INSTALLATION_FILE = 'installation.json';

const EMPTY: Installation = { host: 'local', extensions: [] };

export const readInstallation = (configDir: string): Promise<Installation> =>
  readJsonFile(join(configDir, INSTALLATION_FILE), EMPTY);

// Read, change and write under the lock: the daemon is the only writer.
export const updateInstallation = (
  configDir: string,
  change: (doc: Installation) => Installation
): Promise<Installation> => {
  const file = join(configDir, INSTALLATION_FILE);
  return withFileLock(file, async () => {
    const next = change(await readInstallation(configDir));
    await writeJsonFile(file, next);
    return next;
  });
};

// The entry of id replaced (or added), the order kept; undefined removes it.
export const withEntry = (doc: Installation, id: string, entry?: InstallEntry): Installation => {
  const at = doc.extensions.findIndex((e) => e.id === id);
  const rest = doc.extensions.filter((e) => e.id !== id);
  if (!entry) return { ...doc, extensions: rest };
  if (at < 0) return { ...doc, extensions: [...rest, entry] };
  return { ...doc, extensions: doc.extensions.map((e) => (e.id === id ? entry : e)) };
};
