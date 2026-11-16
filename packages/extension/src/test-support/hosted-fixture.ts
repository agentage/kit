import { linkModules } from './http.js';
import { json, tempPackage } from './packages.js';

// A package as the host sees it: an api part, one setting, one secret, one migration.
export const HOSTED_MANIFEST = {
  name: '@agentage/extension-hosted',
  version: '1.0.0',
  type: 'module',
  engines: { agentage: '^0.14' },
  agentage: {
    id: 'hosted',
    parts: { api: true, store: 'postgres' },
    settings: { 'echo.prefix': { type: 'string', default: '' } },
    secrets: ['api-token'],
  },
};

// The same package with no store: an in-process child then stops at once, also with a hung request.
export const NO_STORE_MANIFEST = {
  ...HOSTED_MANIFEST,
  agentage: { ...HOSTED_MANIFEST.agentage, parts: { api: true } },
};

// No imports, so it loads from a temp folder: a plain middleware is a router to Express.
const API = `export const create = (ctx) => async (req, res, next) => {
  if (req.path === '/echo') {
    const counted = ctx.extension.store && (await ctx.store.query('update hits set n = n + 1 returning n'));
    const rows = counted ? counted.rows : [{ n: 0 }];
    const msg = [ctx.settings['echo.prefix'], req.query.msg].filter(Boolean).join(' ');
    const secret = ctx.secrets.apiToken.length;
    return res.json({ success: true, data: { msg, hits: rows[0].n, secret, pid: process.pid, origin: ctx.extension.origin } });
  }
  if (req.path === '/hang') return;
  if (req.path === '/crash') return res.json({ success: true }), setTimeout(() => process.exit(3), 20);
  if (req.path === '/slow') return setTimeout(() => res.json({ success: true, data: process.pid }), 300);
  if (req.path === '/exit') {
    ctx.exit();
    globalThis.afterExit = true;
    return res.json({ success: true, data: 'bye' });
  }
  next();
};
`;

// A create that asks to exit before the server listens.
export const EXIT_IN_CREATE = `export const create = (ctx) => { ctx.exit(); return (_req, _res, next) => next(); };\n`;

export const hostedPackage = (manifest: object = HOSTED_MANIFEST, api = API) =>
  tempPackage({
    'package.json': json(manifest),
    'dist/api/index.js': api,
    'migrations/001-hits.sql':
      'create table hits (n int not null);\ninsert into hits values (0);\n',
  });

// Every server part like the probe: api, an mcp tool, a worker tick into the store.
export const ALL_PARTS_MANIFEST = {
  ...HOSTED_MANIFEST,
  agentage: {
    id: 'all',
    parts: { api: true, mcp: true, worker: true, store: 'postgres' },
    settings: {
      'mcp.listing': { type: 'string', enum: ['open', 'token'], default: 'open' },
      'mcp.fail': { type: 'boolean', default: false },
      'health.shared': { type: 'boolean', default: false },
      'tick.slow': { type: 'boolean', default: false },
    },
    secrets: [{ name: 'tick-key', parts: ['worker'] }],
  },
};

const ALL_API = `export const create = (ctx) => {
  if (ctx.settings['health.shared']) ctx.health('shared', async () => 'ok');
  return async (req, res, next) => {
  if (req.path !== '/ticks') return next();
  const { rows } = await ctx.store.query('select count(*)::int as n from ticks');
  res.json({ success: true, data: { total: rows[0].n, part: ctx.extension.part } });
  };
};
`;

const ALL_MCP = `import { z } from 'zod';
export const create = (ctx) => {
  if (ctx.settings['mcp.fail']) throw new Error('mcp create failed');
  if (ctx.settings['health.shared']) ctx.health('shared', async () => 'degraded');
  ctx.tool('echo', { description: 'Echo', input: z.object({ msg: z.string() }),
    output: z.object({ msg: z.string() }) }, ({ msg }) => ({ msg: 'pong ' + msg }));
};
`;

const ALL_WORKER = `export const create = ({ schedule, store, secrets, settings }) => {
  if (!secrets.tickKey) throw new Error('no tick key');
  schedule('tick', '* * * * *', async () => {
    if (settings['tick.slow']) (globalThis.tickRunning = true), await new Promise((r) => setTimeout(r, 400));
    await store.query("insert into ticks values ('t')");
  });
};
`;

export const allPartsPackage = async (manifest: object = ALL_PARTS_MANIFEST): Promise<string> => {
  const dir = await tempPackage({
    'package.json': json(manifest),
    'dist/api/index.js': ALL_API,
    'dist/mcp/index.js': ALL_MCP,
    'dist/worker/index.js': ALL_WORKER,
    'migrations/001-ticks.sql': 'create table ticks (job text not null);\n',
  });
  await linkModules(dir);
  return dir;
};
