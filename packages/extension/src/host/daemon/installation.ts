import { copyFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { ExtensionIdSchema } from '../../manifest/primitives.schema.js';
import { readJsonFile, withFileLock, writeJsonFile } from './json-file.js';

// One extension in installation.json (C3): a version, or a source folder; other keys round-trip.
const InstallEntrySchema = z.looseObject({
  id: ExtensionIdSchema,
  version: z.string().min(1).optional(),
  source: z.string().refine(isAbsolute).optional(),
  enabled: z.boolean().optional(),
});

const InstallationSchema = z.looseObject({ host: z.string(), extensions: z.array(z.unknown()) });

export type InstallEntry = z.infer<typeof InstallEntrySchema>;

export interface Installation {
  host: string;
  extensions: InstallEntry[];
  [key: string]: unknown;
}

// The rows that pass the C3 schema; invalid: the file had other rows, or was not C3 at all.
export interface CheckedInstallation {
  doc: Installation;
  invalid: boolean;
}

export const INSTALLATION_FILE = 'installation.json';

const EMPTY: Installation = { host: 'local', extensions: [] };

const checked = (raw: unknown): CheckedInstallation => {
  const top = InstallationSchema.safeParse(raw);
  if (!top.success) return { doc: EMPTY, invalid: true };
  const rows = top.data.extensions.map((row) => InstallEntrySchema.safeParse(row));
  const extensions = rows.flatMap((row) => (row.success ? [row.data] : []));
  return { doc: { ...top.data, extensions }, invalid: extensions.length < rows.length };
};

export const readInstallation = async (configDir: string): Promise<CheckedInstallation> =>
  checked(await readJsonFile(join(configDir, INSTALLATION_FILE), EMPTY).catch(() => null));

// A bad file is kept as installation.json.bad before the daemon writes the valid rows over it.
export const keepBadCopy = (configDir: string): Promise<void> =>
  copyFile(join(configDir, INSTALLATION_FILE), join(configDir, `${INSTALLATION_FILE}.bad`));

// Read, change and write under the lock: the daemon is the only writer.
export const updateInstallation = (
  configDir: string,
  change: (doc: Installation) => Installation
): Promise<Installation> => {
  const file = join(configDir, INSTALLATION_FILE);
  return withFileLock(file, async () => {
    const next = change((await readInstallation(configDir)).doc);
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
