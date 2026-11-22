import {
  combineHost,
  type Answer,
  type CallerState,
  type CombineInput,
  DiscoveryDocumentSchema,
  HostDocumentSchema,
  type HostEntry,
  SERVES_KINDS,
  VersionSchema,
} from '@agentage/extension/internal';
import { appRowOf, type AppRow } from './app-files.js';
import { readDocument } from './document-read.js';
import { type Entries } from './entries.js';
import { type Shell } from './shell-routes.js';
import { type Entry } from './supervisor.js';

// A child that does not answer in this time is read from its last good document.
export const DOC_READ_MS = 1_500;

// By id, one per row: the last valid documents, so a stopped child keeps its nav row.
export type LastGood = Map<string, unknown[]>;

// The document of a running extension at its address, or undefined (no answer, too big, not JSON).
export const readChildDocument = (address: string): Promise<unknown> =>
  readDocument(address, DOC_READ_MS);

const isValid = (doc: unknown) =>
  doc !== undefined && DiscoveryDocumentSchema.safeParse(doc).success;

// Every row of the id, as the routes read them: a pages row is in the document too.
const answersOf = async (entry: Entry, lastGood: LastGood): Promise<Answer[]> => {
  const addresses = entry.lane?.child.addresses() ?? [];
  const read = await Promise.all(addresses.map(readChildDocument));
  const last = lastGood.get(entry.id) ?? [];
  read.forEach((doc, i) => isValid(doc) && (last[i] = doc));
  lastGood.set(entry.id, last);
  // A slow or failed read of a running child keeps its last good document (a bad one is refused).
  const docs = addresses.length ? read.map((doc, i) => doc ?? last[i]) : last;
  return docs
    .filter((document) => document !== undefined)
    .map((document) => ({ upstream: entry.id, document, expectedId: entry.id }));
};

const toldOf = ({ state }: Entry): CallerState | undefined =>
  state === 'starting' || state === 'failed' ? state : undefined;

// On a machine the daemon serves /app/{id}/ from the folder: its entry and css win over the child's (an app-only rebuild).
export const withAppRow = (entry: HostEntry, row: AppRow | undefined): HostEntry => {
  if (!row) return entry;
  const parts = SERVES_KINDS.filter((k) => k === 'app' || entry.parts.includes(k));
  return { ...entry, parts, app: { ...entry.app, ...row } };
};

const statesOf = (all: Entry[]): Record<string, CallerState> => {
  const states: Record<string, CallerState> = {};
  for (const e of all) {
    const told = toldOf(e);
    if (told) states[e.id] = told;
  }
  return states;
};

// On a machine the api and mcp parts are for loopback callers; the app is served from the folder.
// The host document and the lane routes read this one value.
export const LOCAL_EXPOSE = { api: 'internal', mcp: 'internal' } as const;

// The combine input of the daemon: its entries as installation rows, each child its own answer.
const inputOf = async (all: Entry[], lastGood: LastGood, shell?: Shell): Promise<CombineInput> => {
  const answers = (await Promise.all(all.map((e) => answersOf(e, lastGood)))).flat();
  const extensions = all.map((e) => ({
    id: e.id,
    version: e.version,
    enabled: e.state !== 'disabled',
    expose: LOCAL_EXPOSE,
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
