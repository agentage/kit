import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { type Express, type RequestHandler } from 'express';
import { fail } from '../../envelope/envelope.js';
import { hasApp } from './app-files.js';
import { type Entries } from './entries.js';
import { type ShellEvents } from './shell-events.js';

// The shell package the cli pins (K3): its dist/ is served, its name and version are in discovery.
export interface Shell {
  dir: string;
  package: string;
  version: string;
}

export const readShell = async (dir: string): Promise<Shell> => {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Partial<Shell>;
  if (typeof pkg.version !== 'string' || typeof (pkg as { name?: unknown }).name !== 'string')
    throw new Error(`${dir}/package.json has no name or version: not a shell package`);
  return { dir, package: (pkg as { name: string }).name, version: pkg.version };
};

type User = { id: string; email: string; name?: string };

const userOf = (value: unknown): User | null => {
  const user = (value as { user?: Record<string, unknown> } | null)?.user;
  if (typeof user?.['id'] !== 'string' || typeof user['email'] !== 'string') return null;
  const name = typeof user['name'] === 'string' ? { name: user['name'] } : {};
  return { id: user['id'], email: user['email'], ...name };
};

// K9: only user of auth.json leaves the daemon, never a token; a file that is bad reads signed out.
export const sessionOf = async (configDir: string) => {
  const text = await readFile(join(configDir, 'auth.json'), 'utf8').catch(() => 'null');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // signed out
  }
  return { user: userOf(parsed), host: 'local' as const };
};

// First path segments that are daemon routes: an unknown path under them stays a JSON 404.
const OWN = new Set(['api', 'mcp', 'host', 'shell', 'app', 'health', '.well-known']);

const page =
  (shell: Shell, entries: Entries): RequestHandler =>
  async (req, res, next) => {
    const id = req.path.split('/')[1] ?? '';
    if (req.method !== 'GET' || OWN.has(id) || req.accepts(['html', 'json']) !== 'html')
      return next();
    const known = id === '' || (await hasApp(entries, id));
    res.status(known ? 200 : 404).set('Cache-Control', 'no-cache');
    // The daemon names this path: a dot folder above it (~/.agentage) is allowed.
    res.sendFile(
      join(shell.dir, 'dist', 'index.html'),
      { dotfiles: 'allow' },
      (err) => err && next(err)
    );
  };

const notAFile: RequestHandler = (req) => {
  throw fail('NOT_FOUND', `${req.originalUrl} is not a shell file`);
};

// S1.2.1: /, /{id}/* (the shell page, 404 for an id with no app), /shell/*, the session, the events.
export const shellRoutes = (
  app: Express,
  { shell, entries, events, configDir }: ShellDeps
): void => {
  app.get('/shell/session', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await sessionOf(configDir));
  });
  app.get('/shell/events', events.stream);
  if (!shell) return;
  const files = express.static(join(shell.dir, 'dist'), { index: false, dotfiles: 'deny' });
  app.use('/shell', files, notAFile);
  app.use(page(shell, entries));
};

export interface ShellDeps {
  shell?: Shell;
  entries: Entries;
  events: ShellEvents;
  configDir: string;
}
