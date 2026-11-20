import {
  type Answer,
  type CallerState,
  combineHost,
  type Log,
  type Program,
} from '@agentage/extension/internal';
import { hostInstallationOf } from './cloud-check.js';
import { type CloudRows } from './cloud-installation.js';
import { readDocument } from './document-read.js';
import { type Entries } from './entries.js';
import { type Shell } from './shell-routes.js';
import { type StateOf } from './upstream-runner.js';

export const READ_MS = 3_000;
export const EVERY_MS = 5_000;

export type Combined = ReturnType<typeof combineHost>;

export interface CloudDiscovery {
  current(): Combined;
  // The run state of an id as the upstream runner gives it: a view of current(), nothing else.
  stateOf: StateOf;
  // The addresses of an id whose valid document the combine took, in row order (the records).
  servedBy(id: string): string[];
  refresh(): Promise<void>;
  // True once the first pass after start() ended, whatever it found; reads no entry state.
  ready(): boolean;
  start(): Promise<void>;
  stop(): void;
}

export interface DiscoveryOptions {
  installation: CloudRows;
  // The shell the program serves and the program itself: the document reports both as served.
  shell?: Shell;
  program?: Program | undefined;
  // The supervisor's entries: each run gives the addresses of its rows (upstream runner).
  entries: Entries;
  own: string;
  log: Log;
  onChange(): void;
  readMs?: number;
  everyMs?: number;
}

interface Seen {
  answers: Answer[];
  named: Set<string>;
  combined?: Combined;
}

// As a browser asks through the edge (own name, https): the document then names the public host.
export const headersOf = (own: string) => {
  const url = new URL(own);
  return { host: url.host, 'x-forwarded-proto': url.protocol.slice(0, -1) };
};

// Every row of every run, in list order; expectedId: an answer of another id is refused.
const rowsOf = (entries: Entries) =>
  [...entries.values()].flatMap((e) =>
    (e.lane?.child.addresses() ?? []).map((upstream) => ({ upstream, expectedId: e.id }))
  );

// No answer since start: starting; an answer before but no valid one now: down (combineHost).
// Only the documents decide: no supervisor or runner state is told to the combine.
const statesOf = (installation: CloudRows, named: Set<string>) => {
  const states: Record<string, CallerState> = {};
  for (const row of installation.extensions) if (!named.has(row.id)) states[row.id] = 'starting';
  return states;
};

const combineOf = (o: DiscoveryOptions, seen: Seen) =>
  combineHost({
    kind: 'cloud',
    installation: hostInstallationOf(o.installation, o.shell),
    answers: seen.answers,
    states: statesOf(o.installation, seen.named),
    ...(o.program && { program: o.program }),
  });

// One read of every row; a row with no answer now is down until a read gets its document again.
const readOf = (o: DiscoveryOptions, seen: Seen) => async () => {
  const [rows, ms, headers] = [rowsOf(o.entries), o.readMs ?? READ_MS, headersOf(o.own)];
  const docs = await Promise.all(rows.map((row) => readDocument(row.upstream, ms, headers)));
  seen.answers = rows.map((row, i) => ({ ...row, document: docs[i] }));
  // Any answer, even a refused one, means the container is up: a refused row is down.
  rows.forEach((row, i) => docs[i] !== undefined && seen.named.add(row.expectedId));
  const next = combineOf(o, seen);
  const changed = JSON.stringify(next.document) !== JSON.stringify(seen.combined?.document);
  seen.combined = next;
  if (changed) o.onChange();
};

// One read at a time; a read that throws keeps the last combined document and the interval.
const singleFlight = (read: () => Promise<void>, log: Log) => {
  let inFlight: Promise<void> | undefined;
  return () =>
    (inFlight ??= read()
      .catch((err: Error) => log.warn('discovery refresh failed', { reason: err.message }))
      .finally(() => (inFlight = undefined)));
};

// THE ONE SOURCE OF STATE of a cloud host: combineHost of each upstream row's discovery document.
// The host document, the routes and the runs' state() read it; no upstream /health is ever read.
export const createCloudDiscovery = (o: DiscoveryOptions): CloudDiscovery => {
  const seen: Seen = { answers: [], named: new Set() };
  // A throw here (an installation the host schema refuses) refuses the start.
  seen.combined = combineOf(o, seen);
  const current = () => seen.combined as Combined;
  const stateOf: StateOf = (id) =>
    current().document.extensions.find((e) => e.id === id)?.state === 'running'
      ? 'running'
      : 'down';
  const servedBy = (id: string) => {
    const refused = new Set(current().refused.map((r) => r.upstream));
    const ok = (a: Answer) => a.expectedId === id && a.document && !refused.has(a.upstream);
    return seen.answers.filter(ok).map((a) => a.upstream);
  };
  const refresh = singleFlight(readOf(o, seen), o.log);
  let timer: NodeJS.Timeout | undefined;
  let isReady = false;
  const start = () => {
    timer ??= setInterval(() => void refresh(), o.everyMs ?? EVERY_MS).unref();
    return refresh().finally(() => (isReady = true));
  };
  const ready = () => isReady;
  return { current, stateOf, servedBy, refresh, ready, start, stop: () => clearInterval(timer) };
};
