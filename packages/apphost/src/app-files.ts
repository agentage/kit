import { type Express, type RequestHandler } from 'express';
import { fail, readManifest, appRowIn, appStatic, type AppRow } from '@agentage/extension/internal';
import { type Entries } from './entries.js';
import { type Entry } from './supervisor.js';

export { type AppRow };

// The nav row of an enabled entry whose package has the app part, built; else none.
export const appRowOf = async (entry: Entry): Promise<AppRow | undefined> => {
  const dir = entry.dir;
  if (!dir || entry.install.enabled === false) return undefined;
  const pkg = await readManifest(dir).catch(() => undefined);
  return pkg && appRowIn(dir, pkg, entry.id);
};

// The app id of a page path, when the id is installed and has an app row.
export const hasApp = async (entries: Entries, id: string): Promise<boolean> => {
  const entry = entries.get(id);
  return entry !== undefined && (await appRowOf(entry)) !== undefined;
};

const appDirOf = async (entries: Entries, id: string): Promise<string> => {
  const entry = entries.get(id);
  if (!entry || !(await appRowOf(entry))) throw fail('NOT_FOUND', `${id} has no app`);
  return entry.dir ?? '';
};

// GET /app/{id}/*: static from the package folder (not the child), so it answers while the child is down.
const serveApp =
  (entries: Entries): RequestHandler =>
  async (req, res, next) => {
    const root = await appDirOf(entries, String(req.params['id']));
    appStatic(root, false)(req, res, (err?: unknown) =>
      next(err && fail('NOT_FOUND', `${String(req.params['id'])} has no such app file`))
    );
  };

export const appRoutes = (app: Express, entries: Entries) => {
  app.use('/app/:id', serveApp(entries));
};
