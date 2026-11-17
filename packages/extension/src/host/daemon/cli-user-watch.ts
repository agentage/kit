import { type Entries } from './entries.js';
import { cliUserOf, readCliAuth } from './cli-user.js';
import { halt, hold } from './gate.js';
import { type ShellEvents } from './shell-events.js';
import { startEntry, type Entry, type SupervisorDeps } from './supervisor.js';

// The cli user the next child starts with; text is the auth.json it came from.
export interface CliUser {
  text?: string;
  sub?: string;
}

// A failed session check (offline) is tried again this many polls later, with the same file.
const RETRY_POLLS = 30;

const restart = async (deps: SupervisorDeps, entry: Entry): Promise<void> => {
  const release = hold(entry);
  try {
    await halt(entry, deps.drainMs);
    await startEntry(deps, entry);
  } finally {
    release();
  }
};

// Read the file; a new user (sign-in, sign-out, another account) restarts every running child.
export const syncCliUser = async (
  deps: SupervisorDeps,
  entries: Entries,
  events?: ShellEvents,
  polls = 0
) => {
  const text = await readCliAuth(deps.configDir);
  const retry = text !== '' && deps.user.sub === undefined && polls % RETRY_POLLS === 0;
  if (text === deps.user.text && !retry) return false;
  const sub = await cliUserOf(text);
  const changed = sub !== deps.user.sub;
  Object.assign(deps.user, { text, sub });
  // A signed-in file shows its email and name too; signed out says it once, not on each offline retry.
  if (changed || sub !== undefined) events?.send('session', { signedIn: sub !== undefined });
  if (!changed) return false;
  deps.log.info('cli user changed: running extensions restart', { signedIn: sub !== undefined });
  for (const entry of entries.values()) if (entry.lane) await restart(deps, entry);
  return true;
};

// Polled in the change queue, so a restart never runs inside an install, update or reload.
export const watchCliUser = (
  deps: SupervisorDeps,
  entries: Entries,
  events?: ShellEvents
): (() => void) => {
  let polls = 0;
  const tick = () =>
    void deps
      .queue(() => syncCliUser(deps, entries, events, ++polls))
      .catch((err: Error) => deps.log.warn('cli user not read', { reason: err.message }));
  const timer = setInterval(tick, deps.userPollMs);
  timer.unref();
  return () => clearInterval(timer);
};
