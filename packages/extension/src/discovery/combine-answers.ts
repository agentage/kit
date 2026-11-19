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

// The ids some answer is listed for: an unlisted answer never joins them.
type Context = { rows: AnswerRow[]; listed: Set<string>; byId: Sorted['byId'] };

const idRefusal = (doc: DiscoveryDocument, expectedId: string | undefined, listed: Set<string>) => {
  if (expectedId === undefined) return listed.has(doc.id) ? 'not listed for this id' : null;
  return doc.id === expectedId ? null : `claims another id: ${doc.id}`;
};

// The answer's refusal, or the container it adds to its id.
const judge = ({ rows, listed, byId }: Context, answer: Answer): Refusal | Served => {
  const { upstream, document, expectedId } = answer;
  const parsed = DiscoveryDocumentSchema.safeParse(document);
  if (!parsed.success) return { upstream, reason: `invalid: ${issuesOf(parsed.error)}` };
  const doc = parsed.data;
  const claim = idRefusal(doc, expectedId, listed);
  if (claim) return { upstream, id: expectedId ?? doc.id, reason: claim };
  const reason = refusalOf(
    doc,
    rows.find((r) => r.id === doc.id),
    byId.get(doc.id)?.[0]
  );
  return reason ? { upstream, id: doc.id, reason } : { upstream, doc };
};

const sortOne = (context: Context, refused: Refusal[], answer: Answer) => {
  const out = judge(context, answer);
  const { byId } = context;
  if ('reason' in out) refused.push(out);
  else byId.set(out.doc.id, [...(byId.get(out.doc.id) ?? []), out]);
};

// Each valid answer under its id, in answer order; every other answer is refused with its reason.
export const sortAnswers = (rows: AnswerRow[], answers: Answer[]): Sorted => {
  const listed = new Set(answers.flatMap((a) => (a.expectedId ? [a.expectedId] : [])));
  const context: Context = { rows, listed, byId: new Map() };
  const refused: Refusal[] = [];
  for (const answer of answers)
    if (answer.document !== null && answer.document !== undefined)
      sortOne(context, refused, answer);
  return { byId: context.byId, refused };
};
