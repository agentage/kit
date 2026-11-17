import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export const DATA_DIR_LOCKED = 'DATA_DIR_LOCKED';

// The locks of this process: our own pid in a lock not in here is stale (a container is pid 1 again).
const held = new Set<string>();

// Linux: an exited child not reaped yet (state Z) answers kill(0) but holds nothing; a pid reaped since kill(0) is gone.
const gone = (pid: number): boolean => {
  if (process.platform !== 'linux') return false;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
};

const alive = (pid: number): boolean => {
  try {
    return process.kill(pid, 0) && !gone(pid);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// A lock made with wx is empty until its pid is written (slow on a network volume): being written
// for EMPTY_LOCK_MS, then stale.
export const EMPTY_LOCK_MS = 1_000;

// A missing file was just removed by a breaker or a release: nothing to break, take it once more.
const GONE = -1;
const pidIn = (file: string) =>
  readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) =>
    err.code === 'ENOENT' ? String(GONE) : '0'
  );

const holder = async (file: string): Promise<number> => {
  const until = Date.now() + EMPTY_LOCK_MS;
  let pid = await pidIn(file);
  while (pid === '' && Date.now() < until) {
    await sleep(25);
    pid = await pidIn(file);
  }
  const n = Number(pid);
  // Garbage (NUL bytes, text) is NaN, which never equals itself: read it as 0, a stale holder.
  return Number.isInteger(n) ? n : 0;
};

const live = (lock: string, pid: number): boolean =>
  pid === process.pid ? held.has(lock) : pid > 0 && alive(pid);

const locked = (lock: string, pid: number) =>
  Object.assign(
    new Error(`${lock.replace(/[/\\]?(store)?\.lock$/, '')} is open in process ${pid}`),
    {
      code: DATA_DIR_LOCKED,
      pid,
    }
  );

const exists = (err: unknown) => (err as NodeJS.ErrnoException).code === 'EEXIST';

// No hard links on the volume (some network or FUSE mounts): an exclusive create, then the pid.
const create = async (lock: string, pid: number): Promise<boolean> => {
  try {
    await writeFile(lock, String(pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if (!exists(err)) throw err;
    return false;
  }
};

// The lock file at once (a link of a full file), or by create where links fail; false: it exists.
const place = async (from: string, lock: string, pid: number): Promise<boolean> => {
  try {
    await link(from, lock);
    return true;
  } catch (err) {
    return exists(err) ? false : create(lock, pid);
  }
};

const unique = (file: string) => `${file}.${process.pid}.${randomBytes(4).toString('hex')}`;

// A full lock file appears at once or not at all: written aside, then linked (fails if one exists).
const take = async (lock: string): Promise<boolean> => {
  const tmp = unique(lock);
  await writeFile(tmp, String(process.pid));
  try {
    const taken = await place(tmp, lock, process.pid);
    if (taken) held.add(lock);
    return taken;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
};

// A guard left by a breaker that died is removed and taken once more.
const takeDeadGuard = async (guard: string): Promise<boolean> => {
  const pid = await holder(guard);
  if (live(guard, pid)) return false;
  if (pid !== GONE) await unlink(guard).catch(() => undefined);
  return take(guard);
};

// One breaker at a time (<lock>.break): the lock is removed only while it still names the dead pid.
const breakStale = async (lock: string, pid: number): Promise<void> => {
  const guard = `${lock}.break`;
  if (!(await take(guard)) && !(await takeDeadGuard(guard)))
    throw locked(lock, await holder(guard));
  try {
    if ((await holder(lock)) === pid) await unlink(lock).catch(() => undefined);
  } finally {
    rmSync(guard, { force: true });
    held.delete(guard);
  }
};

const turns = new Map<string, Promise<unknown>>();

// One taker per lock in this process: none sees our pid in the file before it is in held.
const inTurn = <T>(lock: string, fn: () => Promise<T>): Promise<T> => {
  const run = (turns.get(lock) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  turns.set(lock, tail);
  void tail.then(() => turns.get(lock) === tail && turns.delete(lock));
  return run;
};

// A lock of an older kit (beside the folder, out of a sealed child's reach): dead is removed, live refuses.
export const clearOldLock = async (lock: string): Promise<void> => {
  const pid = await holder(lock);
  if (pid > 0 && live(lock, pid)) throw locked(lock, pid);
  if (pid > 0) await unlink(lock).catch(() => undefined);
};

const acquire = async (lock: string): Promise<void> => {
  if (await take(lock)) return;
  const pid = await holder(lock);
  if (live(lock, pid)) throw locked(lock, pid);
  if (pid !== GONE) await breakStale(lock, pid);
  if (!(await take(lock))) throw locked(lock, await holder(lock));
};

// PGlite has one writer per folder: the lock (<dataDir>.lock unless given) holds the pid; a dead holder's lock is taken over.
export const lockDataDir = async (
  dataDir: string,
  lock = `${dataDir}.lock`
): Promise<() => Promise<void>> => {
  await inTurn(lock, () => acquire(lock));
  // Sync, so no other taker in this process sees the file without its entry in held.
  return async () => {
    rmSync(lock, { force: true });
    held.delete(lock);
  };
};
