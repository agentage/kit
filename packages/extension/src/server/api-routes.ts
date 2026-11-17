import { Router, type Request, type RequestHandler, type Response } from 'express';
import { isDownload } from '../api/download.js';
import { inQuery } from '../api/openapi-doc.js';
import { type FilesEntry } from '../api/files-registry.js';
import { createRouteRegistry, type ApiContext, type RouteEntry } from '../api/routes.js';
import { type WellKnownEntry } from '../api/well-known.js';
import { type PartContext } from '../context/context.js';
import { clearedAt, rank } from '../auth/token-check.js';
import { fail, isReply, ok, reply } from '../envelope/envelope.js';
import { parse } from '../envelope/parse.js';
import { type ApiHandler } from './part.types.js';
import { sendDownload } from './send-download.js';

const inputOf = ({ method, spec }: RouteEntry, query: unknown, body: unknown) => {
  if (!spec.input) return {};
  if (inQuery(method)) return parse(spec.input, query, 'Invalid query');
  return parse(spec.input, body ?? {}, 'Invalid body');
};

const opaque = (tag: string): string => tag.trim().replace(/^W\//, '');

// If-None-Match names the tag (weak or strong) or is *: the client's copy is current.
const notModified = (req: Request, etag?: string): boolean => {
  const given = req.get('if-none-match');
  if (!given || !etag) return false;
  const tags = given.split(',').map(opaque);
  return tags.includes('*') || tags.includes(opaque(etag));
};

// The envelope by default; a bare route sends the body as it is and answers a current GET 304.
const sendJson = (req: Request, res: Response, spec: RouteEntry['spec'], answer: unknown) => {
  const { data, meta, etag, status = 200 } = isReply(answer) ? answer : reply(answer);
  if (etag) res.setHeader('ETag', etag);
  if (status === 204) return void res.status(204).end();
  const body = spec.output ? spec.output.parse(data) : data;
  if (!spec.bare) return void res.status(status).json(ok(body, meta));
  if (req.method === 'GET' && notModified(req, etag)) return void res.status(304).end();
  res.status(status).json(body);
};

// A scoped handler never runs for a request the route guard did not check at its scope.
const refuseUncleared = (req: Request, { spec }: RouteEntry): void => {
  const need = spec.scope ?? 'read';
  if (need === 'public' || need === 'optional') return;
  const at = clearedAt(req);
  if (at === 'open' || (at !== undefined && rank(at) >= rank(need))) return;
  throw fail('UNAUTHORIZED', 'The route was not checked for a token');
};

// Validated in, the handler's data (bare or a reply) parsed by its output schema and sent in the envelope;
// a file as it is.
const handlerOf =
  (ctx: PartContext, entry: RouteEntry): RequestHandler =>
  async (req, res) => {
    const input = inputOf(entry, req.query, req.body);
    const { query: shape } = entry.spec;
    const query = shape ? parse(shape, req.query, 'Invalid query') : {};
    refuseUncleared(req, entry);
    const caller = ctx.auth.caller(req);
    const { params: schema } = entry.spec;
    const params = schema ? parse(schema, req.params, 'Invalid path') : req.params;
    const ifMatch = req.get('if-match');
    const answer = await entry.handler({
      input,
      query,
      params,
      caller,
      ifMatch,
      ip: req.ip ?? '',
      header: (name) => req.get(name),
    });
    const { produces } = entry.spec;
    if (isDownload(answer) !== (produces !== undefined))
      throw new Error(
        `${entry.path}: download() answers a route that declares produces, and only it`
      );
    if (isDownload(answer)) return sendDownload(res, answer, produces as string);
    sendJson(req, res, entry.spec, answer);
  };

// /items/{id} as Express writes it.
const expressPath = (path: string): string => path.replace(/\{(\w+)\}/g, ':$1');

const routesRouter = (ctx: PartContext, routes: RouteEntry[]): Router => {
  const router = Router();
  for (const entry of routes) router[entry.method](expressPath(entry.path), handlerOf(ctx, entry));
  return router;
};

// What create(ctx) gave: its ctx.route routes, or the router it returned; exactly one (or ctx.files alone).
const handlerFor = (ctx: PartContext, routes: RouteEntry[], returned: unknown, files: boolean) => {
  if (routes.length > 0 && returned)
    throw new Error('the api part registers ctx.route routes and returns a router: pick one');
  if (routes.length > 0 || (files && !returned)) return routesRouter(ctx, routes);
  if (!returned) throw new Error('the api part registers nothing and returns no router');
  return returned as ApiHandler;
};

interface MountedApi {
  router: ApiHandler;
  routes: RouteEntry[];
  documents: WellKnownEntry[];
  files?: FilesEntry;
}

// Runs the api part's create(ctx) with ctx.route; the runtime and the test server mount alike.
export const mountApi = async (
  ctx: PartContext,
  create: (ctx: ApiContext) => unknown
): Promise<MountedApi> => {
  const { route, routes, wellKnown, documents, files, filesServed } = createRouteRegistry();
  const returned = await create({ ...ctx, route, wellKnown, files });
  const router = handlerFor(ctx, routes, returned, filesServed.files !== undefined);
  return { router, routes, documents, files: filesServed.files };
};
