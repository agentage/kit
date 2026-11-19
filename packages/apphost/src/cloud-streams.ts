import { type RequestHandler } from 'express';
import { type CloudDiscovery } from './cloud-discovery.js';
import { unavailableIf } from './cloud-parts.js';
import { forwardTo } from './cloud-proxy.js';
import { partRoute } from './route-of.js';

// PD9: git smart-HTTP at /files/{id}/* to the api part, the connector at /connector/{id} to mcp.
const PATH = /^\/(files|connector)\/([a-z][a-z0-9-]*)(\/.*)?$/;
const PART = { files: 'api', connector: 'mcp' } as const;

// A pipe both ways, no body limit and no answer timeout; Authorization kept (a PAT), Cookie dropped.
export const streamRoutes =
  (discovery: CloudDiscovery): RequestHandler =>
  (req, res, next) => {
    const match = PATH.exec(req.path);
    if (!match || (match[1] === 'connector' && match[3] !== undefined)) return next();
    const [, kind, id] = match as unknown as [string, keyof typeof PART, string];
    const part = PART[kind];
    const combined = discovery.current();
    const route = partRoute(combined.routes, id, part, 'public');
    if (!route) unavailableIf(combined, id, part);
    if (!route) return next();
    // Bearer auth here: a browser cookie of the host is never the extension's.
    const headers = { ...req.headers };
    delete headers.cookie;
    forwardTo(req, res, next, { id, prefix: `/${kind}/${id}`, upstream: route.upstream, headers });
  };
