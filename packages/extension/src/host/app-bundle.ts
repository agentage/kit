import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { type Express, type Response } from 'express';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { APP_DIR, APP_META_FILE, appOf } from '../manifest/parts.js';

// The nav row of a package with a built app part: its meta and the bundle files under /app/{id}/.
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

export const appRowIn = async (
  dir: string,
  pkg: ExtensionPackage,
  id = pkg.agentage.id
): Promise<AppRow | undefined> => {
  const meta = appOf(pkg);
  const files = meta && (await builtFiles(dir).catch(() => undefined));
  if (!meta || !files) return undefined;
  const at = `/app/${id}/`;
  return { ...meta, entry: `${at}${files.entry}`, css: `${at}${files.css}` };
};

// K5: hashed files never change; index.js and app.json name the newest build.
const setAppHeaders = (res: Response, path: string) => {
  const hashed = HASHED.test(path.split('/').pop() ?? '');
  res.set('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
};

export const appStatic = (dir: string, fallthrough: boolean) =>
  express.static(join(dir, APP_DIR), {
    fallthrough,
    index: false,
    dotfiles: 'deny',
    setHeaders: setAppHeaders,
  });

// The one container (C4): /app/{id}/* from dist/app, and /app/{id}/ (no file can have that name) the nav row.
export const mountAppBundle = (app: Express, dir: string, id: string, row?: AppRow) => {
  if (!row) return;
  app.get(`/app/${id}/`, (_req, res) => void res.set('Cache-Control', 'no-cache').json(row));
  app.use(`/app/${id}`, appStatic(dir, true));
};
