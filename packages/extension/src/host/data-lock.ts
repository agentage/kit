import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { link, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export const DATA_DIR_LOCKED = 'DATA_DIR_LOCKED';

// The locks of this process: our own pid in a lock not in here is stale (a container is pid 1 again).
const held = new Set<string>();

const alive = (pid: number): boolean => {
  try {
    return process.kill(pid, 0);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// A lock made with wx is empty until its pid is written (slow on a network volume): being written
// for EMPTY_LOCK_MS, then stale.
export const EMPTY_LOCK_MS = 1_000;

const pidIn = (file: string) => readFile(file, 'utf8').catch(() => '0');

const holder = async (file: string): Promise<number> => {
  const until = Date.now() + EMPTY_LOCK_MS;
  let pid = await pidIn(file);
  while (pid === '' && Date.now() < until) {
    await sleep(25);
    pid = await pidIn(file);
  }
  return Number(pid);
};

const live = (lock: string, pid: number): boolean =>
  pid === process.pid ? held.has(lock) : pid > 0 && alive(pid);

const locked = (lock: string, pid: number) =>
  Object.assign(new Error(`${lock.slice(0, -5)} is open in process ${pid}`), {
    code: DATA_DIR_LOCKED,
    pid,
  });

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

// Only one starter moves the stale file away; one that moved a fresh lock puts it back and refuses.
const clearStale = async (lock: string, pid: number): Promise<void> => {
  const moved = unique(`${lock}.stale`);
  const gone = await rename(lock, moved).then(
    () => false,
    (err: NodeJS.ErrnoException) => err.code === 'ENOENT'
  );
  if (gone) return;
  const now = await holder(moved);
  if (now !== pid) {
    await place(moved, lock, now).catch(() => undefined);
    await unlink(moved);
    throw locked(lock, now);
  }
  await unlink(moved);
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

const acquire = async (lock: string): Promise<void> => {
  if (await take(lock)) return;
  const pid = await holder(lock);
  if (live(lock, pid)) throw locked(lock, pid);
  await clearStale(lock, pid);
  if (!(await take(lock))) throw locked(lock, await holder(lock));
};

// PGlite has one writer per folder: <dataDir>.lock holds the pid; a dead holder's lock is taken over.
export const lockDataDir = async (dataDir: string): Promise<() => Promise<void>> => {
  const lock = `${dataDir}.lock`;
  await inTurn(lock, () => acquire(lock));
  // Sync, so no other taker in this process sees the file without its entry in held.
  return async () => {
    rmSync(lock, { force: true });
    held.delete(lock);
  };
};
