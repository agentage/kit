import { fail } from '@agentage/extension/internal';
import { appRowOf } from './app-files.js';
import { entryOf, type Entries } from './entries.js';
import { type ShellEvents } from './shell-events.js';

// The body of a reload that names the app part: the child keeps running.
export const isAppReload = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  Object.keys(body).length === 1 &&
  (body as { part?: unknown }).part === 'app';

// K8: the new build is in dist/app already; the shell re-imports the entry the event names.
export const reloadApp = async (entries: Entries, id: string, events: ShellEvents) => {
  const entry = entryOf(entries, id);
  const row = await appRowOf(entry);
  if (!row) throw fail('VALIDATION_ERROR', `${id} has no built app: run the app build first`);
  events.send('app', { id, entry: row.entry, css: row.css });
  return { id, version: entry.version, state: entry.state, reloaded: true, part: 'app' };
};
