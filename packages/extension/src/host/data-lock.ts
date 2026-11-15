import { readFile, unlink, writeFile } from 'node:fs/promises';

export const DATA_DIR_LOCKED = 'DATA_DIR_LOCKED';

const alive = (pid: number): boolean => {
  try {
    return process.kill(pid, 0);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const holder = async (lock: string): Promise<number> =>
  Number(await readFile(lock, 'utf8').catch(() => '0'));

// PGlite has one writer per folder: <dataDir>.lock holds the pid; a dead holder's lock is taken over.
export const lockDataDir = async (dataDir: string): Promise<() => Promise<void>> => {
  const lock = `${dataDir}.lock`;
  const take = () => writeFile(lock, String(process.pid), { flag: 'wx' });
  await take().catch(async (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EEXIST') throw err;
    const pid = await holder(lock);
    if (pid && alive(pid))
      throw Object.assign(new Error(`${dataDir} is open in process ${pid}`), {
        code: DATA_DIR_LOCKED,
      });
    await unlink(lock).catch(() => undefined);
    await take();
  });
  return () => unlink(lock).catch(() => undefined);
};
