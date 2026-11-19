import { getJson, type Call } from './http.js';
import { fail } from './reason.js';

export interface Latest {
  id: string;
  version: string;
  // null for a private entry: it has no npm package to install.
  package: string | null;
  // null when the market names no 40-hex commit.
  commit: string | null;
}

export interface Offered {
  id: string;
  version: string;
}

export interface Skipped {
  id: string;
  reason: string;
}

export interface Listing {
  offered: Offered[];
  skipped: Skipped[];
}

const BASE = '/api/market/extensions';
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const SHA = /^[0-9a-f]{40}$/;

export interface MarketCall extends Call {
  origin: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// The market's own refusals for an id it lacks; a router miss or a proxy 404 is none of them.
const UNKNOWN = [
  (id: string) => `no listed extension ${id}`,
  (id: string) => `${id} has no release yet`,
];

export const isUnknownId = (body: unknown, id: string): boolean => {
  const error = isRecord(body) && body['success'] === false ? body['error'] : undefined;
  if (!isRecord(error) || error['code'] !== 'NOT_FOUND') return false;
  return UNKNOWN.some((text) => error['message'] === text(id));
};

// The body of a 2xx; a 404 is the market's answer only when known says so.
const marketGet = async (call: MarketCall, path: string, known = (_b: unknown) => false) => {
  const url = `${call.origin}${BASE}${path}`;
  const { status, body } = await getJson(call, url);
  if (status !== 404) return body;
  return known(body) ? null : fail('market', 'failed', `${url} answered 404, not the market's`);
};

const dataOf = (body: unknown): unknown => (isRecord(body) ? body['data'] : undefined);

// An answer is trusted only when it names this id's own package and one exact version.
const accept = (id: string, data: Record<string, unknown>): Latest => {
  const { version, package: pkg, commit } = data;
  const refuse = (why: string) =>
    fail('market', 'refused', `market answer refused for ${id}: ${why}`);
  if (typeof version !== 'string' || !EXACT.test(version))
    return refuse(`version ${JSON.stringify(version)} is not an exact version`);
  if (pkg !== null && pkg !== `@agentage/extension-${id}` && pkg !== `agentage-extension-${id}`)
    return refuse(`package ${JSON.stringify(pkg)} is not an extension of that id`);
  return {
    id,
    version,
    package: pkg,
    commit: typeof commit === 'string' && SHA.test(commit) ? commit : null,
  };
};

// null: the market itself said it has no such id, or no release of it.
export const latestOf = async (call: MarketCall, id: string): Promise<Latest | null> => {
  const known = (body: unknown) => isUnknownId(body, id);
  const body = await marketGet(call, `/${encodeURIComponent(id)}/latest`, known);
  if (body === null) return null;
  const data = dataOf(body);
  return isRecord(data)
    ? accept(id, data)
    : fail('market', 'refused', `${id}: no release in the answer`);
};

const PAGE = 200;
// A market that repeats its cursor would page for ever; past this the listing stops.
export const MAX_PAGES = 20;
// /latest calls in flight at once while listing.
const AT_ONCE = 8;

const nextOf = (body: unknown): string => {
  const meta = isRecord(body) ? body['meta'] : undefined;
  const page = isRecord(meta) ? meta['pagination'] : undefined;
  const next = isRecord(page) ? page['nextCursor'] : undefined;
  return typeof next === 'string' ? next : '';
};

const rowsOf = async (call: MarketCall, cursor = '', page = 1): Promise<unknown[]> => {
  if (page > MAX_PAGES)
    fail('market', 'failed', `the market list has more than ${MAX_PAGES} pages; stopped there`);
  const query = `?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const body = await marketGet(call, query);
  const data = dataOf(body);
  const rows = Array.isArray(data) ? data : fail('market', 'refused', 'the list has no rows');
  const next = nextOf(body);
  return next && rows.length > 0 ? [...rows, ...(await rowsOf(call, next, page + 1))] : rows;
};

type Row = Offered | Skipped | null;

// A row without an exact version asks /latest; its failure skips that row only.
const rowOf = async (call: MarketCall, row: unknown, why: (e: unknown) => string): Promise<Row> => {
  if (!isRecord(row) || typeof row['id'] !== 'string') return null;
  const { id, version } = row;
  if (typeof version === 'string' && EXACT.test(version)) return { id, version };
  try {
    const latest = await latestOf(call, id);
    return latest
      ? { id, version: latest.version }
      : { id, reason: 'the market has no version of it' };
  } catch (err) {
    return { id, reason: why(err) };
  }
};

// Each listed id with its newest version; only a failed list call fails the listing.
export const listOf = async (call: MarketCall, why: (e: unknown) => string): Promise<Listing> => {
  const rows = await rowsOf(call);
  const found: Row[] = [];
  for (let i = 0; i < rows.length; i += AT_ONCE)
    found.push(...(await Promise.all(rows.slice(i, i + AT_ONCE).map((r) => rowOf(call, r, why)))));
  const listing: Listing = { offered: [], skipped: [] };
  for (const row of found)
    if (row) 'version' in row ? listing.offered.push(row) : listing.skipped.push(row);
  return listing;
};
