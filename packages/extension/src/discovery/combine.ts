import { entryOfDocument, sortAnswers, type Answer, type Refusal } from './combine-answers.js';
import {
  HostDocumentSchema,
  type Expose,
  type HostDocument,
  type HostEntry,
  type HostKind,
} from './host-document.schema.js';
import { routeTable, type Route, type Served } from './route-table.js';
import { SERVES_KINDS } from './served.schema.js';

export { entryOfDocument, type Answer, type Refusal } from './combine-answers.js';
export { type Route } from './route-table.js';

// The rows of installation.json the combine reads; other keys are ignored.
export interface HostInstallation {
  host: string;
  shell?: { package: string; version: string };
  extensions: { id: string; version: string; enabled?: boolean; expose?: Expose }[];
}

export interface Combined {
  document: HostDocument;
  routes: Route[];
  refused: Refusal[];
}

type Row = HostInstallation['extensions'][number];

// What the caller knows of a row that no answer tells: a child that starts, or one that failed.
export type CallerState = 'starting' | 'failed';

const stateOf = (row: Row, served: Served[], told?: CallerState) => {
  if (row.enabled === false) return 'disabled';
  return told ?? (served.length ? 'running' : 'down');
};

// Parts and fields of every container of one id; the first document wins a field two give.
// An entry that is not running keeps the fields of the last good document the caller passes.
const entryOf = (row: Row, served: Served[], told?: CallerState): HostEntry => {
  const expose = row.expose ?? {};
  const state = stateOf(row, served, told);
  const docs = served.map((s) => entryOfDocument(s.doc));
  if (!docs.length) return { id: row.id, version: row.version, parts: [], expose, state };
  const parts = SERVES_KINDS.filter((kind) => docs.some((d) => d.parts.includes(kind)));
  return { ...docs.reduceRight((later, doc) => ({ ...later, ...doc })), parts, expose, state };
};

const documentOf = (installation: HostInstallation, kind: HostKind, entries: HostEntry[]) => {
  const { shell } = installation;
  const named = shell && { shell: { package: shell.package, version: shell.version } };
  return HostDocumentSchema.parse({ host: installation.host, kind, ...named, extensions: entries });
};

const pagesRefusal = (route: Route, site?: Route): Refusal => ({
  upstream: route.upstream,
  id: route.id,
  reason: `a second pages route: / is ${site?.id ?? ''}`,
});

export interface CombineInput {
  kind: HostKind;
  installation: HostInstallation;
  answers: Answer[];
  // By id; unset, a row is running when a container answered for it, else down.
  states?: Record<string, CallerState>;
}

// No I/O: the installation and each container's answer in; the host document and routes out.
// Throws only on an installation the host schema refuses (two rows of one id); a bad answer is refused.
export const combineHost = ({ kind, installation, answers, states }: CombineInput): Combined => {
  const { byId, refused } = sortAnswers(installation.extensions, answers);
  const rows = installation.extensions.map((row) => {
    const served = byId.get(row.id) ?? [];
    return { entry: entryOf(row, served, states?.[row.id]), served };
  });
  const document = documentOf(
    installation,
    kind,
    rows.map((r) => r.entry)
  );
  const { routes, dropped } = routeTable(rows);
  const site = routes.find((r) => r.part === 'pages');
  return { document, routes, refused: [...refused, ...dropped.map((r) => pagesRefusal(r, site))] };
};
