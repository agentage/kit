import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { type Express, type RequestHandler } from 'express';
import { fail } from '../../envelope/envelope.js';
import { APP_DIR, APP_META_FILE, appOf } from '../../manifest/parts.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { type Entries } from './entries.js';
import { type Entry } from './supervisor.js';

export interface AppRow {
  title: string;
  icon?: string;
  order?: number;
  entry: string;
  css: string;
}

const HASHED = /^app-[0-9a-f]+\.(?:js|css)$/;

const builtFiles = async (dir: string) => {
  const text = await readFile(join(dir, APP_DIR, APP_META_FILE), 'utf8');
  const files = JSON.parse(text) as { entry?: unknown; css?: unknown };
  const ok = [files.entry, files.css].every((f) => typeof f === 'string' && HASHED.test(f));
  return ok ? (files as { entry: string; css: string }) : undefined;
};

// The nav row of an enabled entry whose package has the app part, built; else none.
export const appRowOf = async (entry: Entry): Promise<AppRow | undefined> => {
  if (!entry.dir || entry.install.enabled === false) return undefined;
  const meta = await readManifest(entry.dir).then(appOf, () => undefined);
  const files = meta && (await builtFiles(entry.dir).catch(() => undefined));
  if (!meta || !files) return undefined;
  const at = `/app/${entry.id}/`;
  return { ...meta, entry: `${at}${files.entry}`, css: `${at}${files.css}` };
};

// The app id of a page path, when the id is installed and has an app row.
export const hasApp = async (entries: Entries, id: string): Promise<boolean> => {
  const entry = entries.get(id);
  return entry !== undefined && (await appRowOf(entry)) !== undefined;
};

// K5: hashed files never change; index.js and app.json name the newest build.
const cacheOf = (path: string) =>
  HASHED.test(path.split('/').pop() ?? '') ? 'immutable' : 'no-cache';

const setHeaders = (res: express.Response, path: string) => {
  const cache = cacheOf(path);
  res.set('Cache-Control', cache === 'immutable' ? 'public, max-age=31536000, immutable' : cache);
};

const appDirOf = async (entries: Entries, id: string): Promise<string> => {
  const entry = entries.get(id);
  if (!entry || !(await appRowOf(entry))) throw fail('NOT_FOUND', `${id} has no app`);
  return join(entry.dir ?? '', APP_DIR);
};

// GET /app/{id}/*: static from the package folder (not the child), so it answers while the child is down.
const serveApp =
  (entries: Entries): RequestHandler =>
  async (req, res, next) => {
    const root = await appDirOf(entries, String(req.params['id']));
    express.static(root, { fallthrough: false, index: false, dotfiles: 'deny', setHeaders })(
      req,
      res,
      (err?: unknown) =>
        next(err && fail('NOT_FOUND', `${String(req.params['id'])} has no such app file`))
    );
  };

export const appRoutes = (app: Express, entries: Entries) => {
  app.use('/app/:id', serveApp(entries));
};
