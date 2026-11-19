import {
  combineHost,
  type Answer,
  type CallerState,
  type CombineInput,
} from '../../discovery/combine.js';
import { DiscoveryDocumentSchema } from '../../discovery/discovery.schema.js';
import { HostDocumentSchema, type HostEntry } from '../../discovery/host-document.schema.js';
import { SERVES_KINDS } from '../../discovery/served.schema.js';
import { VersionSchema } from '../../manifest/primitives.schema.js';
import { appRowOf, type AppRow } from './app-files.js';
import { type Entries } from './entries.js';
import { type Shell } from './shell-routes.js';
import { type Entry } from './supervisor.js';

const DOC_PATH = '/.well-known/agentage-extension.json';
// A child that does not answer in this time is read from its last good document.
export const DOC_READ_MS = 1_500;
const MAX_BYTES = 256 * 1024;

// By id: the last valid document a child gave, so a stopped child keeps its nav row.
export type LastGood = Map<string, unknown>;

// The document of a running child on its loopback port, or undefined (no answer, too big, not JSON).
export const readChildDocument = async (port: number): Promise<unknown> => {
  try {
    const signal = AbortSignal.timeout(DOC_READ_MS);
    const res = await fetch(`http://127.0.0.1:${port}${DOC_PATH}`, { signal });
    const text = await res.text();
    return res.ok && text.length <= MAX_BYTES ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
};

const answerOf = async (entry: Entry, lastGood: LastGood): Promise<Answer | undefined> => {
  const port = entry.lane?.child.port;
  const read = port === undefined ? undefined : await readChildDocument(port);
  if (read !== undefined && DiscoveryDocumentSchema.safeParse(read).success)
    lastGood.set(entry.id, read);
  const document = entry.lane ? read : lastGood.get(entry.id);
  return document === undefined
    ? undefined
    : { upstream: entry.id, document, expectedId: entry.id };
};

const toldOf = ({ state }: Entry): CallerState | undefined =>
  state === 'starting' || state === 'failed' ? state : undefined;

// On a machine the daemon serves /app/{id}/ from the folder: its row stands when no document names one.
const withAppRow = (entry: HostEntry, row: AppRow | undefined): HostEntry => {
  if (entry.app || !row) return entry;
  const parts = SERVES_KINDS.filter((k) => k === 'app' || entry.parts.includes(k));
  return { ...entry, parts, app: row };
};

const statesOf = (all: Entry[]): Record<string, CallerState> => {
  const states: Record<string, CallerState> = {};
  for (const e of all) {
    const told = toldOf(e);
    if (told) states[e.id] = told;
  }
  return states;
};

// The combine input of the daemon: its entries as installation rows, each child its own answer.
const inputOf = async (all: Entry[], lastGood: LastGood, shell?: Shell): Promise<CombineInput> => {
  const read = await Promise.all(all.map((e) => answerOf(e, lastGood)));
  const answers = read.filter((a): a is Answer => a !== undefined);
  const extensions = all.map((e) => ({
    id: e.id,
    version: e.version,
    enabled: e.state !== 'disabled',
  }));
  const named = shell && { shell: { package: shell.package, version: shell.version } };
  return {
    kind: 'local',
    installation: { host: 'local', ...named, extensions },
    answers,
    states: statesOf(all),
  };
};

// C10 (D10): each running extension and each one with an app (a crashed child keeps its nav row).
export const hostDocumentOf = async (entries: Entries, lastGood: LastGood, shell?: Shell) => {
  // A row with no version yet (its install failed) has no child, no document and no app.
  const all = [...entries.values()].filter((e) => VersionSchema.safeParse(e.version).success);
  const { document } = combineHost(await inputOf(all, lastGood, shell));
  const apps = await Promise.all(all.map(appRowOf));
  const extensions = document.extensions
    .map((entry, i) => withAppRow(entry, apps[i]))
    .filter((entry) => entry.state === 'running' || entry.app);
  return HostDocumentSchema.parse({ ...document, extensions });
};
