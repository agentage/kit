import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { linkModules } from '../../test-support/http.js';
import { API_MANIFEST, json, tempPackage } from '../../test-support/packages.js';
import { check } from '../check.js';
import { generatedOpenapi } from '../../api/openapi-doc.js';
import { createRouteRegistry } from '../../api/routes.js';
import { surface } from './surface.js';

const API = `import { Router } from 'express';
export const create = () => {
  const router = Router();
  router.get('/items/:id', (_req, res) => res.json({}));
  router.post('/items', (_req, res) => res.json({}));
  return router;
};
`;

const MCP = `import { z } from 'zod';
export const create = (ctx) =>
  ctx.tool('echo', { description: 'Echo', input: z.object({ msg: z.string() }), output: z.object({}) }, () => ({}));
`;

const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const ECHO = {
  name: 'probe__echo',
  description: 'Echo',
  inputSchema: {
    $schema: SCHEMA,
    type: 'object',
    properties: { msg: { type: 'string' } },
    required: ['msg'],
  },
  outputSchema: { $schema: SCHEMA, type: 'object', properties: {}, additionalProperties: false },
};

const read = { get: { security: [{ pat: ['probe:read'] }] } };
const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'probe', version: '0.1.0' },
  paths: { '/api/probe/items/{id}': read, '/api/probe/items': { post: { security: [] } } },
};

const surfaceOf = async (files: Record<string, string>, parts: object = { api: true }) => {
  const manifest = { ...API_MANIFEST, agentage: { id: 'probe', parts } };
  const dir = await tempPackage({ 'package.json': json(manifest), ...files });
  await linkModules(dir);
  return (await check(dir, { rules: [surface] })).problems.map((p) => `${p.file} ${p.problem}`);
};

const EXPORT = `import { download } from '@agentage/extension';
export const create = (ctx) =>
  ctx.route('get', '/export', { summary: 'Export', produces: 'application/zip' }, () => download('z'));
`;

const SYNC = `import { z } from 'zod';
export const create = (ctx) =>
  ctx.route('get', '/sync', { summary: 'Sync', bare: true, etag: true, output: z.object({ ttl: z.number() }) }, () => ({ ttl: 1 }));
`;

describe('surface, the api part', () => {
  it('passes a bare route, against the contract the kit writes', async () => {
    const { route, routes } = createRouteRegistry();
    const output = z.object({ ttl: z.number() });
    route('get', '/sync', { summary: 'Sync', bare: true, etag: true, output }, () => ({ ttl: 1 }));
    const manifest = { ...API_MANIFEST, agentage: { id: 'probe', parts: { api: true } } };
    const files = {
      'dist/api/index.js': SYNC,
      'openapi.json': json(generatedOpenapi(manifest, routes)),
    };
    expect(await surfaceOf(files)).toEqual([]);
  });

  it('passes a route that produces a file, against the contract the kit writes', async () => {
    const { route, routes } = createRouteRegistry();
    route('get', '/export', { summary: 'Export', produces: 'application/zip' }, () => 'z');
    const manifest = { ...API_MANIFEST, agentage: { id: 'probe', parts: { api: true } } };
    const doc = generatedOpenapi(manifest, routes);
    const files = { 'dist/api/index.js': EXPORT, 'openapi.json': json(doc) };
    expect(await surfaceOf(files)).toEqual([]);
  });

  it('passes when openapi.json documents exactly the routes, each with its access', async () => {
    expect(await surfaceOf({ 'dist/api/index.js': API, 'openapi.json': json(OPENAPI) })).toEqual(
      []
    );
  });

  it('names each route or version that differs, and an operation without declared access', async () => {
    const stale = {
      ...OPENAPI,
      info: { version: '0.0.9' },
      paths: { '/api/probe/items/{id}': { get: {} }, '/api/probe/gone': read },
    };
    const extra = API.replace('return router;', 'router.use(Router());\n  return router;');
    expect(await surfaceOf({ 'dist/api/index.js': extra, 'openapi.json': json(stale) })).toEqual([
      'openapi.json differs from the generated contract (info.version 0.1.0, POST /api/probe/items, router sub-router, info.version 0.0.9, GET /api/probe/gone)',
      'openapi.json GET /api/probe/items/{id} declares neither a scope nor security: []',
    ]);
  });

  it('reads only the HTTP methods of a path; router.all, an array path, a middleware pass', async () => {
    const pathLevel = {
      parameters: [{ name: 'id', in: 'path' }],
      summary: 's',
      servers: [],
      $ref: '#/x',
    };
    const doc = {
      ...OPENAPI,
      paths: {
        '/api/probe/items/{id}': { ...read, ...pathLevel, description: 'd' },
        '/api/probe/items': { post: { security: [] } },
        '/api/probe/a': read,
        '/api/probe/b': read,
      },
    };
    const code = `import express, { Router } from 'express';
export const create = () => {
  const router = Router();
  router.use(express.json());
  router.get('/items/:id', (_req, res) => res.json({}));
  router.post('/items', (_req, res) => res.json({}));
  router.get(['/a', '/b'], (_req, res) => res.json({}));
  router.all('/any', (_req, res) => res.json({}));
  return router;
};
`;
    expect(await surfaceOf({ 'dist/api/index.js': code, 'openapi.json': json(doc) })).toEqual([]);
  });

  it('reads the routes of an express() app too, and survives a null path item', async () => {
    const app = `import express from 'express';
export const create = () => {
  const app = express();
  app.get('/hidden', (_req, res) => res.json({}));
  return app;
};
`;
    const doc = { ...OPENAPI, paths: { '/api/probe/echo': null } };
    expect(await surfaceOf({ 'dist/api/index.js': app, 'openapi.json': json(doc) })).toEqual([
      'openapi.json differs from the generated contract (GET /api/probe/hidden)',
    ]);
  });

  it('needs the committed contract; leaves a part that does not load to entries', async () => {
    expect(await surfaceOf({ 'dist/api/index.js': API })).toEqual([
      'openapi.json is missing: the api part commits its contract',
    ]);
    expect(await surfaceOf({})).toEqual([]);
  });
});

describe('surface, the mcp part', () => {
  const snapshot = (tools: object[]) =>
    json({ serverInfo: { name: 'agentage-probe', version: '0.1.0' }, tools });

  it('passes when the committed tool list is what the SDK lists for the code', async () => {
    const files = { 'dist/mcp/index.js': MCP, 'probe.mcpc.json': snapshot([ECHO]) };
    expect(await surfaceOf(files, { mcp: true })).toEqual([]);
  });

  it('names each tool that differs, and a missing snapshot', async () => {
    const stale = [
      { ...ECHO, description: 'Old' },
      { ...ECHO, name: 'probe__gone' },
    ];
    const files = { 'dist/mcp/index.js': MCP, 'probe.mcpc.json': snapshot(stale) };
    expect(await surfaceOf(files, { mcp: true })).toEqual([
      'probe.mcpc.json differs from the generated tool list (probe__echo, probe__gone)',
    ]);
    expect(await surfaceOf({ 'dist/mcp/index.js': MCP }, { mcp: true })).toEqual([
      'probe.mcpc.json is missing: the mcp part commits its tool list',
    ]);
  });
});
