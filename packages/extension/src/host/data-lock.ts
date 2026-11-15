import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { link, readFile, rename, unlink, writeFile } from 'node:fs/promises';

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

const holder = async (file: string): Promise<number> =>
  Number(await readFile(file, 'utf8').catch(() => '0'));

const live = (lock: string, pid: number): boolean =>
  pid === process.pid ? held.has(lock) : pid > 0 && alive(pid);

const locked = (lock: string, pid: number) =>
  Object.assign(new Error(`${lock.slice(0, -5)} is open in process ${pid}`), {
    code: DATA_DIR_LOCKED,
  });

const unique = (file: string) => `${file}.${process.pid}.${randomBytes(4).toString('hex')}`;

// A full lock file appears at once or not at all: written aside, then linked (fails if one exists).
const take = async (lock: string): Promise<boolean> => {
  const tmp = unique(lock);
  await writeFile(tmp, String(process.pid));
  try {
    await link(tmp, lock);
    held.add(lock);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return false;
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
    await link(moved, lock).catch(() => undefined);
    await unlink(moved);
    throw locked(lock, now);
  }
  await unlink(moved);
};

// PGlite has one writer per folder: <dataDir>.lock holds the pid; a dead holder's lock is taken over.
export const lockDataDir = async (dataDir: string): Promise<() => Promise<void>> => {
  const lock = `${dataDir}.lock`;
  if (!(await take(lock))) {
    const pid = await holder(lock);
    if (live(lock, pid)) throw locked(lock, pid);
    await clearStale(lock, pid);
    if (!(await take(lock))) throw locked(lock, await holder(lock));
  }
  // Sync, so no other taker in this process sees the file without its entry in held.
  return async () => {
    rmSync(lock, { force: true });
    held.delete(lock);
  };
};
