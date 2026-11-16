import { HOSTED_MANIFEST } from './hosted-fixture.js';
import { linkModules } from './http.js';
import { json, tempPackage } from './packages.js';

// Like memory: git smart-HTTP from the api part, the connector profile beside the mcp tools.
export const MOUNTS_MANIFEST = {
  name: '@agentage/extension-mem',
  version: '1.0.0',
  type: 'module',
  engines: HOSTED_MANIFEST.engines,
  agentage: { id: 'mem', parts: { api: true, mcp: true } },
};

// Counts the body it gets: a pack passes as it came, no parser, no 1 MB limit.
const API = `export const create = (ctx) => {
  ctx.git((req, res) => {
    let bytes = 0;
    req.on('data', (chunk) => (bytes += chunk.length));
    req.on('end', () => res.json({ path: req.path, sub: ctx.auth.caller(req)?.sub ?? null, bytes }));
  });
};
`;

const MCP = `import { z } from 'zod';
export const create = (ctx) => {
  ctx.tool('echo', { description: 'Echo', input: z.object({}), output: z.object({}) }, () => ({}));
  ctx.connector('search', { description: 'Search', input: z.object({ query: z.string() }),
    output: z.object({ ids: z.array(z.string()) }) }, ({ query }, caller) =>
    ({ ids: [query, caller?.sub ?? 'nobody'] }));
};
`;

export const mountsPackage = async (): Promise<string> => {
  const dir = await tempPackage({
    'package.json': json(MOUNTS_MANIFEST),
    'dist/api/index.js': API,
    'dist/mcp/index.js': MCP,
  });
  await linkModules(dir);
  return dir;
};
