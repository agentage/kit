import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { fail } from '../../envelope/envelope.js';
import { parse } from '../../envelope/parse.js';
import { ExtensionIdSchema } from '../../manifest/primitives.schema.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { persist, summary, type Entries } from './entries.js';
import { runInstaller } from './installer-call.js';
import { type InstallEntry } from './installation.js';
import { startEntry, type Entry, type SupervisorDeps } from './supervisor.js';

const RESERVED_ID = 'host';

// enabled: false records the extension and never starts it (a profile "off" entry).
const AddSchema = z.union([
  z.strictObject({
    id: ExtensionIdSchema,
    version: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  }),
  z.strictObject({
    source: z.string().refine(isAbsolute, 'an absolute path'),
    enabled: z.boolean().optional(),
  }),
]);

const reserve = (entries: Entries, id: string): void => {
  if (id === RESERVED_ID) throw fail('VALIDATION_ERROR', 'the id host is reserved');
  if (entries.has(id)) throw fail('CONFLICT', `${id} is installed`);
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

// POST: installs (or links a folder), records it, then starts it; a failed start stays listed as failed.
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
  const entry: Entry = {
    id: install.id,
    install,
    state: 'disabled',
    version: got.version,
    dir: got.dir,
  };
  entries.set(entry.id, entry);
  if (!off) await startEntry(deps, entry);
  return summary(entry);
};
