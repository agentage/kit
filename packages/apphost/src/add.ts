import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { validRange } from 'semver';
import { z } from 'zod';
import { fail, parse, ExtensionIdSchema, readManifest } from '@agentage/extension/internal';
import { persist, summary, type Entries } from './entries.js';
import { runInstaller } from './installer-call.js';
import { type InstallEntry } from './installation.js';
import { clearRunDir, dataDirOf } from './daemon-files.js';
import { needsSecret } from './start-checks.js';
import { startEntry, startFailed, type Entry, type SupervisorDeps } from './supervisor.js';

const RESERVED_ID = 'host';

// The cli's rule for what follows `<id>@`: a version, a range or a dist-tag; never a path, URL or flag.
const DIST_TAG = /^[A-Za-z][\w.-]*$/;
const isVersionSpec = (spec: string): boolean =>
  !/\s/.test(spec) && (validRange(spec) !== null || DIST_TAG.test(spec));

// POST and PATCH: the same rule, so no route hands the installer a path.
export const VersionSpecSchema = z
  .string()
  .min(1)
  .refine(isVersionSpec, 'a version, a range or a dist-tag');

// enabled: false records the extension and never starts it (a profile "off" entry).
const AddSchema = z.union([
  z.strictObject({
    id: ExtensionIdSchema,
    version: VersionSpecSchema.optional(),
    enabled: z.boolean().optional(),
  }),
  z.strictObject({
    source: z.string().refine(isAbsolute, 'an absolute path'),
    enabled: z.boolean().optional(),
  }),
]);

// The entry a 409 names, so a client can tell a repeat from another package of that id.
const existing = ({ id, version, install }: Entry) => ({
  id,
  ...(version ? { version } : {}),
  ...(install.source ? { source: install.source } : {}),
});

const reserve = (entries: Entries, id: string): void => {
  if (id === RESERVED_ID) throw fail('VALIDATION_ERROR', 'the id host is reserved');
  const has = entries.get(id);
  if (has) throw fail('CONFLICT', `${id} is installed`, { details: existing(has) });
};

const sourceEntry = async (source: string) => {
  const pkg = await readManifest(source).catch((err: Error) => {
    throw fail('VALIDATION_ERROR', `${source}: ${err.message}`);
  });
  return { install: { id: pkg.agentage.id, source }, dir: source, version: pkg.version };
};

const marketEntry = async (
  deps: SupervisorDeps,
  entries: Entries,
  id: string,
  version?: string
) => {
  reserve(entries, id);
  const got = await runInstaller(deps, { id, version });
  return { install: { id: got.id, version: got.version }, dir: got.dir, version: got.version };
};

// C6: a new id that did not start leaves no row; only a data folder this start made goes too.
const rollBack = async (deps: SupervisorDeps, entries: Entries, entry: Entry, fresh: boolean) => {
  entries.delete(entry.id);
  await persist(deps, entry.id);
  await clearRunDir(deps.configDir, entry.id);
  if (fresh) await rm(dataDirOf(deps.configDir, entry.id), { recursive: true, force: true });
};

// The first start; refused and rolled back unless it waits for a secret or the daemon stops (kept).
const firstStart = async (deps: SupervisorDeps, entries: Entries, entry: Entry) => {
  const fresh = !existsSync(dataDirOf(deps.configDir, entry.id));
  const err = await startEntry(deps, entry);
  if (!err || needsSecret(err) || deps.stopping.signal.aborted) return;
  await rollBack(deps, entries, entry, fresh);
  throw startFailed(entry, err);
};

// POST: installs (or links a folder), records it, then starts it (C6: a failed start is refused).
export const addExtension = async (deps: SupervisorDeps, entries: Entries, body: unknown) => {
  const spec = parse(AddSchema, body, 'Invalid body');
  const got =
    'source' in spec
      ? await sourceEntry(spec.source)
      : await marketEntry(deps, entries, spec.id, spec.version);
  reserve(entries, got.install.id);
  const off = spec.enabled === false;
  const install: InstallEntry = off ? { ...got.install, enabled: false } : got.install;
  await persist(deps, install.id, install);
  const entry: Entry = { ...got, id: install.id, install, state: 'disabled' };
  entries.set(entry.id, entry);
  if (!off) await firstStart(deps, entries, entry);
  return summary(entry);
};
