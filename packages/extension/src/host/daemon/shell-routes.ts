import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type RequestHandler } from 'express';
import { fail } from '../../envelope/envelope.js';
import { hasApp } from './app-files.js';
import { type CliUser } from './cli-user-watch.js';
import { type Entries } from './entries.js';
import { type ShellEvents } from './shell-events.js';

// The shell the kit carries (dist/shell, written by the kit build); none when run from src.
export const kitShellDir = (base: string = import.meta.url): string | undefined => {
  const dir = fileURLToPath(new URL('../../shell', base));
  return existsSync(join(dir, 'package.json')) ? dir : undefined;
};

// A shell package (the kit's own or shellDir): dist/ is served; name and version go in discovery.
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

type User = { id: string; email?: string; name?: string };

const textOf = (value: unknown) => (typeof value === 'string' ? value : undefined);

// K9: the user the children run as (issuer checked in cli-user.ts); email, name of its auth.json.
export const sessionOf = ({ sub, text }: CliUser): { user: User | null; host: 'local' } => {
  if (sub === undefined) return { user: null, host: 'local' };
  let shown: Record<string, unknown> = {};
  try {
    shown = (JSON.parse(text ?? '') as { user?: Record<string, unknown> }).user ?? {};
  } catch {
    // the sub alone
  }
  const email = textOf(shown['email']);
  const name = textOf(shown['name']);
  return { user: { id: sub, ...(email && { email }), ...(name && { name }) }, host: 'local' };
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
export const shellRoutes = (app: Express, { shell, entries, events, user }: ShellDeps): void => {
  app.get('/shell/session', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(sessionOf(user));
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
  user: CliUser;
}
