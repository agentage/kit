import { chmod, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';

export const readJsonFile = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
};

// A reader sees the old file or the new one, never half of one.
export const writeJsonFile = async (file: string, value: unknown, mode = 0o644): Promise<void> => {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await chmod(tmp, mode);
  await rename(tmp, file);
};

const STALE_MS = 10_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A lock left by a process that died holding it is taken over after STALE_MS.
const takeOver = async (lock: string): Promise<void> => {
  const age = await stat(lock).then(
    (s) => Date.now() - s.mtimeMs,
    () => 0
  );
  if (age > STALE_MS) await unlink(lock).catch(() => undefined);
};

const acquire = async (lock: string): Promise<void> => {
  for (let tries = 0; tries < 200; tries += 1) {
    try {
      return void (await (await open(lock, 'wx')).close());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      await takeOver(lock);
      await pause(25);
    }
  }
  throw new Error(`${lock} is held by another process`);
};

// One writer at a time across processes: an exclusive lock file beside the file.
export const withFileLock = async <T>(file: string, fn: () => Promise<T>): Promise<T> => {
  const lock = `${file}.lock`;
  await acquire(lock);
  try {
    return await fn();
  } finally {
    await unlink(lock).catch(() => undefined);
  }
};
