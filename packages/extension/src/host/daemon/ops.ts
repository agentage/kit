import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { fail } from '../../envelope/envelope.js';
import { parse } from '../../envelope/parse.js';
import { ExtensionIdSchema } from '../../manifest/primitives.schema.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { purgeData, writeValues } from './daemon-files.js';
import { updateInstallation, withEntry, type InstallEntry } from './installation.js';
import {
  halt,
  noInstaller,
  startEntry,
  swap,
  valuesOf,
  type Entry,
  type Next,
  type SupervisorDeps,
} from './supervisor.js';

export const RESERVED_ID = 'host';

const AddSchema = z.union([
  z.strictObject({ id: ExtensionIdSchema, version: z.string().min(1).optional() }),
  z.strictObject({ source: z.string().refine(isAbsolute, 'an absolute path') }),
]);

const PatchSchema = z.strictObject({
  version: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.string()).optional(),
});

type Patch = z.infer<typeof PatchSchema>;

export type Entries = Map<string, Entry>;

// pid of a running child: the e2e teardown reads it.
export const summary = ({ id, version, state, error, lane }: Entry) => ({
  id,
  version,
  state,
  ...(lane && { pid: lane.child.pid }),
  ...(error && { error }),
});

export const listed = (entry: Entry) => ({
  ...summary(entry),
  source: entry.install.source ?? 'market',
  enabled: entry.install.enabled !== false,
});

const reserve = (entries: Entries, id: string): void => {
  if (id === RESERVED_ID) throw fail('VALIDATION_ERROR', 'the id host is reserved');
  if (entries.has(id)) throw fail('CONFLICT', `${id} is installed`);
};

const sourceEntry = async (source: string): Promise<{ install: InstallEntry; dir: string }> => {
  const pkg = await readManifest(source).catch((err: Error) => {
    throw fail('VALIDATION_ERROR', `${source}: ${err.message}`);
  });
  return { install: { id: pkg.agentage.id, source }, dir: source };
};

const marketEntry = async (
  deps: SupervisorDeps,
  entries: Entries,
  id: string,
  version?: string
) => {
  reserve(entries, id);
  if (!deps.install) throw noInstaller();
  const got = await deps.install({ id, version });
  return { install: { id: got.id, version: got.version }, dir: got.dir };
};

const persist = (deps: SupervisorDeps, id: string, install?: InstallEntry) =>
  updateInstallation(deps.configDir, (doc) => withEntry(doc, id, install));

// POST: installs (or links a folder), records it, starts it; a failed start stays listed as failed.
export const addExtension = async (deps: SupervisorDeps, entries: Entries, body: unknown) => {
  const spec = parse(AddSchema, body, 'Invalid body');
  const { install, dir } =
    'source' in spec
      ? await sourceEntry(spec.source)
      : await marketEntry(deps, entries, spec.id, spec.version);
  reserve(entries, install.id);
  const entry: Entry = {
    id: install.id,
    install,
    state: 'starting',
    version: '',
    dir,
  };
  entries.set(entry.id, entry);
  await persist(deps, entry.id, install);
  await startEntry(deps, entry);
  return summary(entry);
};

const entryOf = (entries: Entries, id: string): Entry => {
  const entry = entries.get(id);
  if (!entry) throw fail('NOT_FOUND', `${id} is not installed`);
  return entry;
};

// The install entry a patch asks for; a new version is installed first and its folder kept aside.
const nextInstall = async (deps: SupervisorDeps, entry: Entry, patch: Patch) => {
  // enabled absent means true (C3), so only false is written.
  const install: InstallEntry = { ...entry.install };
  delete install.enabled;
  if ((patch.enabled ?? entry.install.enabled) === false) install.enabled = false;
  if (!patch.version) return { install };
  if (install.source)
    throw fail('VALIDATION_ERROR', `${entry.id} runs a folder: it has no version`);
  if (!deps.install) throw noInstaller();
  const got = await deps.install({ id: entry.id, version: patch.version });
  return { install: { ...install, version: got.version }, dir: got.dir };
};

const nextOf = async (deps: SupervisorDeps, entry: Entry, patch: Patch): Promise<Next> => {
  const was = await valuesOf(deps.configDir, entry.id);
  const settings = { ...was.settings, ...patch.settings };
  const values = { settings, secrets: { ...was.secrets, ...patch.secrets } };
  return { ...(await nextInstall(deps, entry, patch)), values };
};

const save = async (deps: SupervisorDeps, entry: Entry, to: Next) => {
  Object.assign(entry, { install: to.install }, to.dir && { dir: to.dir });
  await persist(deps, entry.id, to.install);
  await writeValues(deps.configDir, 'settings', entry.id, to.values.settings);
  await writeValues(deps.configDir, 'secrets', entry.id, to.values.secrets);
};

// Disabled: stopped. Running: swapped with 0 lost requests. Not running: started once saved.
const apply = async (deps: SupervisorDeps, entry: Entry, to: Next) => {
  const enabled = to.install.enabled !== false;
  if (!enabled) {
    await halt(entry);
    entry.state = 'disabled';
  } else if (entry.lane) await swap(deps, entry, to);
  await save(deps, entry, to);
  if (enabled && !entry.lane) await startEntry(deps, entry);
};

// PATCH: values persist only once the new child runs; a refused change keeps the old one.
export const changeExtension = async (
  deps: SupervisorDeps,
  entries: Entries,
  id: string,
  body: unknown
) => {
  const patch = parse(PatchSchema, body, 'Invalid body');
  const entry = entryOf(entries, id);
  await apply(deps, entry, await nextOf(deps, entry, patch));
  return summary(entry);
};

// DELETE: stops the child, forgets its settings and secrets; purge also deletes its data folder.
export const removeExtension = async (
  deps: SupervisorDeps,
  entries: Entries,
  id: string,
  purge: boolean
) => {
  const entry = entryOf(entries, id);
  entries.delete(id);
  await halt(entry);
  await persist(deps, id);
  await writeValues(deps.configDir, 'settings', id);
  await writeValues(deps.configDir, 'secrets', id);
  if (purge) await purgeData(deps.configDir, id);
  return { id };
};
