import { DiscoveryDocumentSchema, type DiscoveryDocument } from './discovery.schema.js';
import { type Expose, type HostDocument, type HostEntry } from './host-document.schema.js';
import { type HostKind } from './host-document.schema.js';
import { routeTable, type Route, type Served } from './route-table.js';
import { SERVES_KINDS } from './served.schema.js';

export { type Route } from './route-table.js';

// The rows of installation.json the combine reads; other keys are ignored.
export interface HostInstallation {
  host: string;
  shell?: { package: string; version: string };
  extensions: { id: string; version: string; enabled?: boolean; expose?: Expose }[];
}

// One container's answer at /.well-known/agentage-extension.json; null or undefined: no answer.
export interface Answer {
  upstream: string;
  document: unknown;
}

export interface Refusal {
  upstream: string;
  id?: string;
  reason: string;
}

export interface Combined {
  document: HostDocument;
  routes: Route[];
  refused: Refusal[];
}

type Row = HostInstallation['extensions'][number];

// The fields of one extension document that the host document repeats as they are.
export const entryOfDocument = (doc: DiscoveryDocument) => ({
  id: doc.id,
  version: doc.version,
  commit: doc.commit,
  parts: SERVES_KINDS.filter((kind) => doc.serves.includes(kind)),
  ...(doc.tools && { tools: doc.tools }),
  ...(doc.openapi && { openapi: doc.openapi }),
  ...(doc.app && { app: doc.app }),
});

const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
  error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');

// Why an answer is not used for its row, or null when it is.
const refusalOf = (doc: DiscoveryDocument, row: Row | undefined, first?: DiscoveryDocument) => {
  if (!row) return 'unknown id';
  if (row.enabled === false) return 'disabled';
  if (doc.version !== row.version) return `version ${doc.version}, not ${row.version}`;
  return first && first.commit !== doc.commit ? `another build than ${first.commit}` : null;
};

// Each valid answer under its id, in answer order; every other answer is refused with its reason.
const sortAnswers = (rows: Row[], answers: Answer[]) => {
  const byId = new Map<string, Served[]>();
  const refused: Refusal[] = [];
  for (const { upstream, document } of answers) {
    if (document === null || document === undefined) continue;
    const parsed = DiscoveryDocumentSchema.safeParse(document);
    if (!parsed.success) {
      refused.push({ upstream, reason: `invalid: ${issuesOf(parsed.error)}` });
      continue;
    }
    const doc = parsed.data;
    const reason = refusalOf(
      doc,
      rows.find((r) => r.id === doc.id),
      byId.get(doc.id)?.[0]?.doc
    );
    if (reason) refused.push({ upstream, id: doc.id, reason });
    else byId.set(doc.id, [...(byId.get(doc.id) ?? []), { upstream, doc }]);
  }
  return { byId, refused };
};

// Parts and fields of every container of one id, in serve order; the first document gives the rest.
const entryOf = (row: Row, served: Served[]): HostEntry => {
  const expose = row.expose ?? {};
  const state = row.enabled === false ? 'disabled' : served.length ? 'running' : 'down';
  if (state !== 'running') return { id: row.id, version: row.version, parts: [], expose, state };
  const docs = served.map((s) => entryOfDocument(s.doc));
  const parts = SERVES_KINDS.filter((kind) => docs.some((d) => d.parts.includes(kind)));
  const fields = Object.assign({}, ...[...docs].reverse()) as ReturnType<typeof entryOfDocument>;
  return { ...fields, ...docs[0], parts, expose, state };
};

// No I/O: the installation and each container's answer in; the host document and routes out.
export const combineHost = (input: {
  kind: HostKind;
  installation: HostInstallation;
  answers: Answer[];
}): Combined => {
  const { installation, kind } = input;
  const { byId, refused } = sortAnswers(installation.extensions, input.answers);
  const rows = installation.extensions.map((row) => {
    const served = byId.get(row.id) ?? [];
    return { entry: entryOf(row, served), served };
  });
  const shell = installation.shell && {
    shell: { package: installation.shell.package, version: installation.shell.version },
  };
  const document = {
    host: installation.host,
    kind,
    ...shell,
    extensions: rows.map((r) => r.entry),
  };
  return { document, routes: routeTable(rows), refused };
};
