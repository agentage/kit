import { json, tempPackage } from './packages.js';

// A package as the host sees it: an api part, one setting, one secret, one migration.
export const HOSTED_MANIFEST = {
  name: '@agentage/extension-hosted',
  version: '1.0.0',
  type: 'module',
  engines: { agentage: '^0.12' },
  agentage: {
    id: 'hosted',
    parts: { api: true, store: 'postgres' },
    settings: { 'echo.prefix': { type: 'string', default: '' } },
    secrets: ['api-token'],
  },
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
