import { z } from 'zod';
import { fail } from '../../envelope/envelope.js';
import { parse } from '../../envelope/parse.js';
import { SecretNameSchema } from '../../manifest/primitives.schema.js';
import { purgeData } from './daemon-files.js';
import { entryOf, summary, type Entries } from './entries.js';
import { writeAll } from './write-all.js';
import { runInstaller } from './installer-call.js';
import { checkedSettings } from './patch-values.js';
import { type InstallEntry } from './installation.js';
import {
  halt,
  hold,
  swap,
  valuesOf,
  type Entry,
  type Next,
  type SupervisorDeps,
  type Values,
} from './supervisor.js';

const PatchSchema = z.strictObject({
  version: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(SecretNameSchema, z.string()).optional(),
});

type Patch = z.infer<typeof PatchSchema>;

// The install entry a patch asks for; a new version is installed first and its folder kept aside.
const nextInstall = async (deps: SupervisorDeps, entry: Entry, patch: Patch) => {
  // enabled absent means true (C3), so only false is written.
  const install: InstallEntry = { ...entry.install };
  delete install.enabled;
  if ((patch.enabled ?? entry.install.enabled) === false) install.enabled = false;
  if (!patch.version) return { install };
  if (install.source)
    throw fail('VALIDATION_ERROR', `${entry.id} runs a folder: it has no version`);
  const got = await runInstaller(deps, { id: entry.id, version: patch.version });
  return { install: { ...install, version: got.version }, dir: got.dir };
};

// The change, and the values on disk now: what a failed write puts back.
const nextOf = async (deps: SupervisorDeps, entry: Entry, patch: Patch) => {
  const next = await nextInstall(deps, entry, patch);
  const dir = next.dir ?? entry.dir ?? entry.install.source;
  const given = await checkedSettings(dir, patch, entry.id);
  const was = await valuesOf(deps.configDir, entry.id);
  const settings = { ...was.settings, ...given };
  const values = { settings, secrets: { ...was.secrets, ...patch.secrets } };
  return { to: { ...next, values } as Next, was };
};

// Disabled: written, then stopped. Else written, then swapped; a refused start puts the files back.
const apply = async (deps: SupervisorDeps, entry: Entry, to: Next, was: Values) => {
  const back = { install: entry.install, values: was };
  await writeAll(deps, entry.id, to, back);
  const undo = () => writeAll(deps, entry.id, back, to).catch(() => undefined);
  if (to.install.enabled !== false) await swap(deps, entry, to, undo);
  else await halt(entry, deps.drainMs);
  Object.assign(entry, { install: to.install }, to.dir && { dir: to.dir });
  if (to.install.enabled === false) entry.state = 'disabled';
};

// A request sent once the change is decided waits (gateMs) and goes to the result.
const held = async (deps: SupervisorDeps, entry: Entry, to: Next, was: Values) => {
  const release = hold(entry);
  try {
    await apply(deps, entry, to, was);
  } finally {
    release();
  }
};

// PATCH: a refused change keeps the old one and is 400 START_FAILED.
export const changeExtension = async (
  deps: SupervisorDeps,
  entries: Entries,
  id: string,
  body: unknown
) => {
  const patch = parse(PatchSchema, body, 'Invalid body');
  const entry = entryOf(entries, id);
  const { to, was } = await nextOf(deps, entry, patch);
  await held(deps, entry, to, was);
  return summary(entry);
};

// DELETE: the files first (all or none), then the child stops; purge also deletes its data folder.
export const removeExtension = async (
  deps: SupervisorDeps,
  entries: Entries,
  id: string,
  purge: boolean
) => {
  const entry = entryOf(entries, id);
  await writeAll(
    deps,
    id,
    {},
    { install: entry.install, values: await valuesOf(deps.configDir, id) }
  );
  entries.delete(id);
  await halt(entry, deps.drainMs);
  if (purge) await purgeData(deps.configDir, id);
  return { id };
};
