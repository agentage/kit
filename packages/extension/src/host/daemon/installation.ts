import { copyFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { fail } from '../../envelope/envelope.js';
import { ExtensionIdSchema } from '../../manifest/primitives.schema.js';
import { assertNoOtherDaemon } from './daemon-owner.js';
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

// The rows that pass the C3 schema, the first of each id; invalid: the file had others, or was not C3.
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
  const valid = rows.flatMap((row) => (row.success ? [row.data] : []));
  const extensions = valid.filter((row, at) => valid.findIndex((e) => e.id === row.id) === at);
  return { doc: { ...top.data, extensions }, invalid: extensions.length < rows.length };
};

// At boot the daemon has no rows from it, so a fix needs a restart; later a fix is enough.
const unreadable = (why: string, atBoot = false) =>
  fail(
    'CONFLICT',
    `${INSTALLATION_FILE} cannot be read (${why}): fix it${atBoot ? ', then restart the daemon' : ''}; no change is written`,
    { code: 'INSTALLATION_UNREADABLE', details: { reason: why } }
  );

const reasonOf = (err: unknown) =>
  err instanceof SyntaxError
    ? 'not JSON'
    : String((err as NodeJS.ErrnoException).code ?? (err as Error).message);

// A file that is not JSON: read as empty (kept aside first), or refused like an unreadable one.
type NotJson = 'empty' | 'refuse';

// Not readable (EACCES, EISDIR): thrown.
const rawOf = (configDir: string, notJson: NotJson = 'empty') =>
  readJsonFile(join(configDir, INSTALLATION_FILE), EMPTY).catch((err: unknown) => {
    if (err instanceof SyntaxError && notJson === 'empty') return null;
    throw err;
  });

const readInstallation = async (configDir: string, notJson: NotJson) =>
  checked(
    await rawOf(configDir, notJson).catch((err: unknown) => {
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
  if (why) throw unreadable(why, true);
  await readInstallation(configDir, 'refuse');
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

type Change = (doc: Installation) => Installation;

const changeInstallation =
  (notJson: NotJson) =>
  async (configDir: string, change: Change, waitMs?: number): Promise<Installation> => {
    await assertNoOtherDaemon(configDir);
    const file = join(configDir, INSTALLATION_FILE);
    const write = async () => {
      const read = await readInstallation(configDir, notJson);
      if (read.invalid) await keepBadCopy(configDir);
      const next = checkedDoc(change(read.doc));
      await writeJsonFile(file, next);
      return next;
    };
    return withFileLock(file, write, waitMs);
  };

/**
 * Read, change and write installation.json under the kit's lock, the path the daemon uses.
 * Only while no daemon runs on configDir (it reads the file at its start and owns it after):
 * a live daemon named by daemon.json is refused, unless this is that daemon's process.
 */
export const updateInstallation = changeInstallation('empty');

// The daemon after its boot: its rows are in the file, so a file that is not JSON is never replaced.
export const persistInstallation = changeInstallation('refuse');

// The entry of id replaced (or added), the order kept; undefined removes it.
export const withEntry = (doc: Installation, id: string, entry?: InstallEntry): Installation => {
  const at = doc.extensions.findIndex((e) => e.id === id);
  const rest = doc.extensions.filter((e) => e.id !== id);
  if (!entry) return { ...doc, extensions: rest };
  if (at < 0) return { ...doc, extensions: [...rest, entry] };
  return { ...doc, extensions: doc.extensions.map((e) => (e.id === id ? entry : e)) };
};
