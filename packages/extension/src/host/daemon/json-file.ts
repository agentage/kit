import { randomBytes } from 'node:crypto';
import { chmod, open, readFile, rename } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
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

// The pid lock of data-lock.ts: a dead holder's lock is taken over, a live one is waited for.
const acquire = async (file: string): Promise<() => Promise<void>> => {
  for (let tries = 0; ; tries += 1) {
    try {
      return await lockDataDir(file);
    } catch (err) {
      if ((err as { code?: string }).code !== DATA_DIR_LOCKED || tries >= 200) throw err;
      await sleep(25);
    }
  }
};

// One writer at a time across processes: an exclusive lock file (<file>.lock) beside the file.
export const withFileLock = async <T>(file: string, fn: () => Promise<T>): Promise<T> => {
  const release = await acquire(file);
  try {
    return await fn();
  } finally {
    await release();
  }
};
