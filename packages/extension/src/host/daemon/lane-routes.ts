import { type RequestHandler } from 'express';
import { combineHost } from '../../discovery/combine.js';
import { fail } from '../../envelope/envelope.js';
import { type Entries } from './entries.js';
import { readChildDocument } from './host-document.js';
import { type Lane } from './lane.js';
import { type Entry } from './supervisor.js';

export type LanePart = 'api' | 'mcp';

// On a machine the api and mcp parts are for loopback callers; the app is served from the folder.
const LOCAL_EXPOSE = { api: 'internal', mcp: 'internal' } as const;

// The routes of one child, from its discovery through combineHost; read once per lane, not cached
// on a failed read. A document the combine refuses gives no routes.
export const laneRoutes = async (entry: Entry, lane: Lane): Promise<Set<string> | undefined> => {
  if (lane.routes) return lane.routes;
  const document = await readChildDocument(lane.child.port);
  if (document === undefined) return undefined;
  const row = { id: entry.id, version: entry.version, expose: LOCAL_EXPOSE };
  const installation = { host: 'local', extensions: [row] };
  const answers = [{ upstream: entry.id, document, expectedId: entry.id }];
  try {
    const { routes } = combineHost({ kind: 'local', installation, answers });
    lane.routes = new Set(routes.map((r) => r.part));
  } catch {
    return undefined;
  }
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
