import { DiscoveryDocumentSchema, type DiscoveryDocument } from './discovery.schema.js';
import { ExtensionEntrySchema } from './host-document.schema.js';
import { type Served } from './route-table.js';
import { SERVES_KINDS } from './served.schema.js';

// One container's answer at /.well-known/agentage-extension.json; null or undefined: no answer.
// expectedId: the installation id the caller listed this container for; unset, any id is taken.
export interface Answer {
  upstream: string;
  document: unknown;
  expectedId?: string;
}

export interface Refusal {
  upstream: string;
  id?: string;
  reason: string;
}

export interface AnswerRow {
  id: string;
  version: string;
  enabled?: boolean;
}

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

// Why a valid document still gives an entry the host schema refuses, or null when it does not.
export const entryRefusal = (doc: DiscoveryDocument): string | null => {
  const entry = { ...entryOfDocument(doc), expose: {}, state: 'running' };
  const parsed = ExtensionEntrySchema.safeParse(entry);
  return parsed.success ? null : `invalid entry: ${issuesOf(parsed.error)}`;
};

// Why an answer is not used for its row, or null when it is.
const refusalOf = (doc: DiscoveryDocument, row: AnswerRow | undefined, first?: Served) => {
  if (!row) return 'unknown id';
  if (row.enabled === false) return 'disabled';
  if (doc.version !== row.version) return `version ${doc.version}, not ${row.version}`;
  const bad = entryRefusal(doc);
  if (bad) return bad;
  return first && first.doc.commit !== doc.commit ? `another build than ${first.doc.commit}` : null;
};

type Sorted = { byId: Map<string, Served[]>; refused: Refusal[] };

// The answer's refusal, or the container it adds to its id.
const judge = (rows: AnswerRow[], byId: Sorted['byId'], answer: Answer): Refusal | Served => {
  const { upstream, document, expectedId } = answer;
  const parsed = DiscoveryDocumentSchema.safeParse(document);
  if (!parsed.success) return { upstream, reason: `invalid: ${issuesOf(parsed.error)}` };
  const doc = parsed.data;
  if (expectedId !== undefined && doc.id !== expectedId)
    return { upstream, id: expectedId, reason: `claims another id: ${doc.id}` };
  const reason = refusalOf(
    doc,
    rows.find((r) => r.id === doc.id),
    byId.get(doc.id)?.[0]
  );
  return reason ? { upstream, id: doc.id, reason } : { upstream, doc };
};

const sortOne = (rows: AnswerRow[], { byId, refused }: Sorted, answer: Answer) => {
  const out = judge(rows, byId, answer);
  if ('reason' in out) refused.push(out);
  else byId.set(out.doc.id, [...(byId.get(out.doc.id) ?? []), out]);
};

// Each valid answer under its id, in answer order; every other answer is refused with its reason.
export const sortAnswers = (rows: AnswerRow[], answers: Answer[]): Sorted => {
  const sorted: Sorted = { byId: new Map(), refused: [] };
  for (const answer of answers)
    if (answer.document !== null && answer.document !== undefined) sortOne(rows, sorted, answer);
  return sorted;
};
