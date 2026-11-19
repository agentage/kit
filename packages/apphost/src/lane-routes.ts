import { type RequestHandler } from 'express';
import { combineHost, fail } from '@agentage/extension/internal';
import { type Entries } from './entries.js';
import { readChildDocument } from './host-document.js';
import { type Lane } from './lane.js';
import { type Entry } from './supervisor.js';

export type LanePart = 'api' | 'mcp';

// On a machine the api and mcp parts are for loopback callers; the app is served from the folder.
const LOCAL_EXPOSE = { api: 'internal', mcp: 'internal' } as const;

// How long a failed read answers 503 at once, so a broken child does not cost each request a read.
export const FAILED_READ_MS = 5_000;

// A document the combine refuses gives no routes; no document (or a row it throws on) is none.
const readRoutes = async (entry: Entry, lane: Lane): Promise<Set<string> | undefined> => {
  const document = await readChildDocument(lane.child.port);
  if (document === undefined) return undefined;
  const row = { id: entry.id, version: entry.version, expose: LOCAL_EXPOSE };
  const installation = { host: 'local', extensions: [row] };
  const answers = [{ upstream: entry.id, document, expectedId: entry.id }];
  try {
    const { routes } = combineHost({ kind: 'local', installation, answers });
    return new Set(routes.map((r) => r.part));
  } catch {
    return undefined;
  }
};

// The routes of one child, from its discovery through combineHost: one read per lane, shared by
// the requests that come while it runs; a failed read is kept FAILED_READ_MS, then read again.
export const laneRoutes = (
  entry: Entry,
  lane: Lane,
  now = Date.now
): Promise<Set<string> | undefined> => {
  if (lane.failedUntil !== undefined && now() < lane.failedUntil) return Promise.resolve(undefined);
  const failed = () => {
    lane.routes = undefined;
    lane.failedUntil = now() + FAILED_READ_MS;
    return undefined;
  };
  // A read that throws is a failed read too: no rejected promise stays on the lane.
  lane.routes ??= readRoutes(entry, lane).then((routes) => routes ?? failed(), failed);
  return lane.routes;
};

// Before the proxy: a running child answers only the parts its routes name (J.4.3 row 4).
// No entry or no child: the proxy answers as before (404 unknown or disabled, 503 not running).
export const servesPart =
  (entries: Entries, part: LanePart): RequestHandler =>
  async (req, _res, next) => {
    const entry = entries.get(String(req.params['id']));
    const lane = entry?.lane;
    if (!entry || !lane) return next();
    const served = await laneRoutes(entry, lane);
    if (!served)
      throw fail('UNAVAILABLE', `${entry.id} did not answer its discovery: try again`, {
        retryAfter: 5,
      });
    if (!served.has(part)) throw fail('NOT_FOUND', `${entry.id} does not serve ${part}`);
    next();
  };
