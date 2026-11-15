import { randomBytes } from 'node:crypto';
import { chmod, open, readFile, rename } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { basename } from 'node:path';
import { fail } from '../../envelope/envelope.js';
import { DATA_DIR_LOCKED, lockDataDir } from '../data-lock.js';

export const readJsonFile = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
};

// A reader sees the old file or the new one, never half of one, also after a power loss.
export const writeJsonFile = async (file: string, value: unknown, mode = 0o644): Promise<void> => {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(tmp, 'w', mode);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(tmp, mode);
  await rename(tmp, file);
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
  const release = await acquire(file, waitMs);
  try {
    return await fn();
  } finally {
    await release();
  }
};
