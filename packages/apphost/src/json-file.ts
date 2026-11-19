import { randomBytes } from 'node:crypto';
import { chmod, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { constants } from 'node:os';
import { basename, dirname } from 'node:path';
import { fail, DATA_DIR_LOCKED, lockDataDir } from '@agentage/extension/internal';

export const readJsonFile = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
};

// Fixed words only: a parser message quotes the file, and secrets.json holds secrets.
export const unreadableReason = (err: unknown): string =>
  err instanceof SyntaxError
    ? 'not JSON'
    : String((err as NodeJS.ErrnoException).code ?? (err as Error).message);

// The folder is full or not writable: the errno, the file and where to look, never a bare 500.
const NOT_WRITABLE = ['ENOSPC', 'EDQUOT', 'EROFS', 'EACCES', 'EPERM'];

// Node has no code name for EDQUOT on Linux ("Unknown system error -122"): read the errno too.
const errnoName = (err: unknown): string => {
  const { errno, code } = err as NodeJS.ErrnoException;
  return errno === -constants.errno.EDQUOT ? 'EDQUOT' : (code ?? '');
};

export const unwritable = (file: string, err: unknown) => {
  const code = errnoName(err);
  if (!NOT_WRITABLE.includes(code)) return err;
  const message = `${basename(file)} cannot be written (${code}): check the free space and rights of ${dirname(file)}; no change was made`;
  return fail('UNAVAILABLE', message, { retryAfter: 30 });
};

// The mode of a file already there, narrowed by the default: a 0600 file is never widened.
const modeOf = (file: string, mode: number) =>
  stat(file).then(
    (st) => st.mode & mode & 0o777,
    () => mode
  );

// A reader sees the old file or the new one, never half of one, also after a power loss.
export const writeJsonFile = async (file: string, value: unknown, given = 0o644): Promise<void> => {
  const mode = await modeOf(file, given);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const handle = await open(tmp, 'w', mode);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(tmp, mode);
    await rename(tmp, file);
  } catch (err) {
    // A full disk leaves no half tmp file beside the real one.
    await unlink(tmp).catch(() => undefined);
    throw unwritable(file, err);
  }
};

export const LOCK_WAIT_MS = 5_000;

// A live holder (or a reused pid of a dead one) named, so a person can check that process.
const lockedBy = (file: string, err: { pid?: number }, waitMs: number) =>
  fail(
    'UNAVAILABLE',
    `${basename(file)} is locked by process ${err.pid ?? 0}: waited ${waitMs} ms`,
    { retryAfter: 1 }
  );

// The pid lock of data-lock.ts: a dead holder's lock is taken over, a live one waited for waitMs.
const acquire = async (file: string, waitMs: number): Promise<() => Promise<void>> => {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      return await lockDataDir(file);
    } catch (err) {
      if ((err as { code?: string }).code !== DATA_DIR_LOCKED) throw err;
      if (Date.now() >= until) throw lockedBy(file, err as { pid?: number }, waitMs);
      await sleep(25);
    }
  }
};

// One writer at a time across processes: an exclusive lock file (<file>.lock) beside the file.
export const withFileLock = async <T>(
  file: string,
  fn: () => T | Promise<T>,
  waitMs = LOCK_WAIT_MS
): Promise<T> => {
  const release = await acquire(file, waitMs).catch((err: unknown) => {
    throw unwritable(file, err);
  });
  try {
    return await fn();
  } finally {
    await release();
  }
};
