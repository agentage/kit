import { copyFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { fail } from '../../envelope/envelope.js';
import { ExtensionIdSchema } from '../../manifest/primitives.schema.js';
import { readJsonFile, withFileLock, writeJsonFile } from './json-file.js';

// One extension in installation.json (C3): a version, or a source folder; other keys round-trip.
const InstallEntrySchema = z.looseObject({
  id: ExtensionIdSchema,
  version: z.string().min(1).optional(),
  source: z.string().refine(isAbsolute).optional(),
  enabled: z.boolean().optional(),
});

const InstallationSchema = z.looseObject({
  host: z.string().default('local'),
  extensions: z.array(z.unknown()),
});

export type InstallEntry = z.infer<typeof InstallEntrySchema>;

export interface Installation {
  host: string;
  extensions: InstallEntry[];
  [key: string]: unknown;
}

// The rows that pass the C3 schema; invalid: the file had other rows, or was not C3 at all.
interface CheckedInstallation {
  doc: Installation;
  invalid: boolean;
}

const INSTALLATION_FILE = 'installation.json';

const EMPTY: Installation = { host: 'local', extensions: [] };

const checked = (raw: unknown): CheckedInstallation => {
  const top = InstallationSchema.safeParse(raw);
  if (!top.success) return { doc: EMPTY, invalid: true };
  const rows = top.data.extensions.map((row) => InstallEntrySchema.safeParse(row));
  const extensions = rows.flatMap((row) => (row.success ? [row.data] : []));
  return { doc: { ...top.data, extensions }, invalid: extensions.length < rows.length };
};

const unreadable = (why: string) =>
  fail(
    'CONFLICT',
    `${INSTALLATION_FILE} cannot be read (${why}): fix it, then restart the daemon; no change is written`,
    { code: 'INSTALLATION_UNREADABLE' }
  );

const reasonOf = (err: unknown) =>
  String((err as NodeJS.ErrnoException).code ?? (err as Error).message);

// Not JSON: null (invalid, kept aside). Not readable (EACCES, EISDIR): thrown.
const rawOf = (configDir: string) =>
  readJsonFile(join(configDir, INSTALLATION_FILE), EMPTY).catch((err: unknown) => {
    if (err instanceof SyntaxError) return null;
    throw err;
  });

export const readInstallation = async (configDir: string): Promise<CheckedInstallation> =>
  checked(
    await rawOf(configDir).catch((err: unknown) => {
      throw unreadable(reasonOf(err));
    })
  );

// At boot an unreadable file gives no rows and its reason; the daemon then refuses every change.
export const bootInstallation = (configDir: string) =>
  rawOf(configDir).then(
    (raw): CheckedInstallation & { unreadable?: string } => checked(raw),
    (err: unknown) => ({ doc: EMPTY, invalid: false, unreadable: reasonOf(err) })
  );

// A change is refused when the file was unreadable at boot (why) or is unreadable now.
export const assertReadable = async (configDir: string, why?: string): Promise<void> => {
  if (why) throw unreadable(why);
  await readInstallation(configDir);
};

// A bad file is kept as installation.json.bad before the daemon writes the valid rows over it.
export const keepBadCopy = (configDir: string): Promise<void> =>
  copyFile(join(configDir, INSTALLATION_FILE), join(configDir, `${INSTALLATION_FILE}.bad`));

// Only rows C3 accepts are written, and each id once.
const checkedDoc = (next: Installation): Installation => {
  const ids = next.extensions.map((row) => row.id);
  const bad = next.extensions.find((row) => !InstallEntrySchema.safeParse(row).success);
  if (bad || new Set(ids).size < ids.length || !InstallationSchema.safeParse(next).success)
    throw fail('VALIDATION_ERROR', `${INSTALLATION_FILE}: a row C3 refuses, or an id twice`);
  return next;
};

// Read, change and write under the lock: the daemon, and the cli's one-time move, use this one path.
export const updateInstallation = (
  configDir: string,
  change: (doc: Installation) => Installation,
  waitMs?: number
): Promise<Installation> => {
  const file = join(configDir, INSTALLATION_FILE);
  return withFileLock(
    file,
    async () => {
      const read = await readInstallation(configDir);
      if (read.invalid) await keepBadCopy(configDir);
      const next = checkedDoc(change(read.doc));
      await writeJsonFile(file, next);
      return next;
    },
    waitMs
  );
};

// The entry of id replaced (or added), the order kept; undefined removes it.
export const withEntry = (doc: Installation, id: string, entry?: InstallEntry): Installation => {
  const at = doc.extensions.findIndex((e) => e.id === id);
  const rest = doc.extensions.filter((e) => e.id !== id);
  if (!entry) return { ...doc, extensions: rest };
  if (at < 0) return { ...doc, extensions: [...rest, entry] };
  return { ...doc, extensions: doc.extensions.map((e) => (e.id === id ? entry : e)) };
};
