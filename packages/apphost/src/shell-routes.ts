import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { type Express, type Request, type RequestHandler } from 'express';
import { fail } from '@agentage/extension/internal';
import { hasApp } from './app-files.js';
import { type CliUser } from './cli-user-watch.js';
import { type Entries } from './entries.js';
import { type ShellEvents } from './shell-events.js';
import { cliUserSource, sessionOf } from './session.js';
import { LOCAL_SIGN_IN, signInPage } from './sign-in-page.js';

// A shell package (@agentage/shell-dashboard or shellDir): dist/ is served; name and version go in discovery.
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

// First path segments that are daemon routes: an unknown path under them stays a JSON 404.
const OWN = new Set(['api', 'mcp', 'host', 'shell', 'app', 'health', '.well-known']);

export interface PageRule {
  // The id has an app the page can show (else the page answers 404).
  isApp(id: string): boolean | Promise<boolean>;
  // The request asks for a page, not a JSON answer.
  wantsPage(req: Request): boolean;
}

// The daemon: HTML before JSON in Accept (no Accept, or */*, is a page too).
export const htmlFirst = (req: Request): boolean => req.accepts(['html', 'json']) === 'html';

const page =
  (shell: Shell, { isApp, wantsPage }: PageRule): RequestHandler =>
  async (req, res, next) => {
    const id = req.path.split('/')[1] ?? '';
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (!read || OWN.has(id) || !wantsPage(req)) return next();
    const known = id === '' || (await isApp(id));
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

// S1.2.1: /, /{id}/* (the shell page, 404 for an id with no app), /shell/*, the session, the events,
// and the page of the Sign in link.
export const shellRoutes = (app: Express, { shell, entries, events, user }: ShellDeps): void => {
  app.get('/shell/session', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(sessionOf(cliUserSource(user)));
  });
  app.get(LOCAL_SIGN_IN, signInPage);
  app.get('/shell/events', events.stream);
  if (shell) shellFiles(app, shell, { isApp: (id) => hasApp(entries, id), wantsPage: htmlFirst });
};

// /shell/* (the files of dist/) and the page at / and /{id}: the same on the daemon and a cloud host.
export const shellFiles = (app: Express, shell: Shell, rule: PageRule): void => {
  const files = express.static(join(shell.dir, 'dist'), { index: false, dotfiles: 'deny' });
  app.use('/shell', files, notAFile);
  app.use(page(shell, rule));
};

export interface ShellDeps {
  shell?: Shell;
  entries: Entries;
  events: ShellEvents;
  user: CliUser;
}
