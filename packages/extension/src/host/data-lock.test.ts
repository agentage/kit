import type * as FsPromises from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempDir } from '../test-support/packages.js';
import { deadPid } from '../test-support/processes.js';
import { clearOldLock, DATA_DIR_LOCKED, EMPTY_LOCK_MS, lockDataDir } from './data-lock.js';

// A volume with no hard links (some CIFS and FUSE mounts): link fails with EPERM.
// onRead: runs once the file was read (another starter acts in that window); onRename: after a rename.
const fs = vi.hoisted(() => ({
  noLink: false,
  links: 0,
  onRead: undefined as ((file: string, text: string) => Promise<void>) | undefined,
  onRename: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof FsPromises>();
  const link: typeof real.link = async (from, to) => {
    fs.links += 1;
    if (!fs.noLink) return real.link(from, to);
    throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' });
  };
  const readFile = (async (file: string, enc: BufferEncoding) => {
    const text = await real.readFile(file, enc);
    await fs.onRead?.(file, text);
    return text;
  }) as typeof real.readFile;
  const rename: typeof real.rename = async (from, to) => {
    await real.rename(from, to);
    await fs.onRename?.();
  };
  return { ...real, link, readFile, rename };
});

const lockIn = async (pid: number | string) => {
  const data = join(await tempDir('agentage-lock-'), 'hosted');
  await writeFile(`${data}.lock`, String(pid));
  return data;
};
const pid = async (data: string) => readFile(`${data}.lock`, 'utf8');

describe.each([
  ['hard links', false],
  ['no hard links (exclusive create)', true],
])('lockDataDir with %s', (_name, noLink) => {
  const each = () =>
    Object.assign(fs, { noLink, links: 0, onRead: undefined, onRename: undefined });

  it('takes a free lock and writes its pid; a second take refuses', async () => {
    each();
    const data = join(await tempDir('agentage-lock-'), 'hosted');
    const release = await lockDataDir(data);
    expect(await pid(data)).toBe(String(process.pid));
    await expect(lockDataDir(data)).rejects.toMatchObject({ code: DATA_DIR_LOCKED });
    await release();
    expect(fs.links).toBeGreaterThan(0);
  });

  it('takes over the lock of a dead holder', async () => {
    each();
    const data = await lockIn(deadPid());
    const release = await lockDataDir(data);
    expect(await pid(data)).toBe(String(process.pid));
    await release();
  });

  it('takes over a lock with our own pid that this process does not hold (pid 1 in a container)', async () => {
    each();
    const data = await lockIn(process.pid);
    const release = await lockDataDir(data);
    await expect(lockDataDir(data)).rejects.toMatchObject({ code: DATA_DIR_LOCKED });
    await release();
    expect((await lockDataDir(data)) instanceof Function).toBe(true);
  });

  it('refuses a live holder and names its pid', async () => {
    each();
    const data = await lockIn(process.ppid);
    await expect(lockDataDir(data)).rejects.toMatchObject({
      code: DATA_DIR_LOCKED,
      pid: process.ppid,
      message: `${data} is open in process ${process.ppid}`,
    });
    expect(await pid(data)).toBe(String(process.ppid));
  });

  it('two starts on one stale lock: one takes it, the other refuses, no file is left aside', async () => {
    each();
    const data = await lockIn(deadPid());
    const results = await Promise.allSettled([lockDataDir(data), lockDataDir(data)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: DATA_DIR_LOCKED },
    });
    expect(await readdir(join(data, '..'))).toEqual(['hosted.lock']);
  });

  it('a fresh lock another starter takes while we judge the old one stale is never moved or replaced', async () => {
    each();
    const dead = deadPid();
    const data = await lockIn(dead);
    const real = await vi.importActual<typeof FsPromises>('node:fs/promises');
    // A breaks the stale lock and takes it right after our read; C takes any lock path left free.
    fs.onRead = async (file, text) => {
      if (file !== `${data}.lock` || text !== String(dead)) return;
      fs.onRead = undefined;
      await real.writeFile(`${data}.lock`, String(process.ppid));
    };
    fs.onRename = async () => void (await real.writeFile(`${data}.lock`, '1', { flag: 'wx' }));
    await expect(lockDataDir(data)).rejects.toMatchObject({ pid: process.ppid });
    expect(await pid(data)).toBe(String(process.ppid));
    expect(await readdir(join(data, '..'))).toEqual(['hosted.lock']);
  });

  it('a live breaker (its guard): refuses and leaves the stale lock alone', async () => {
    each();
    const dead = deadPid();
    const data = await lockIn(dead);
    await writeFile(`${data}.lock.break`, String(process.ppid));
    await expect(lockDataDir(data)).rejects.toMatchObject({ pid: process.ppid });
    expect(await pid(data)).toBe(String(dead));
  });

  it('a guard left by a dead breaker is removed, then the stale lock is taken over', async () => {
    each();
    const data = await lockIn(deadPid());
    await writeFile(`${data}.lock.break`, String(deadPid()));
    const release = await lockDataDir(data);
    expect(await pid(data)).toBe(String(process.pid));
    expect(await readdir(join(data, '..'))).toEqual(['hosted.lock']);
    await release();
  });

  it('an empty lock (created, pid not yet written) is read again: filled meanwhile, it is live', async () => {
    each();
    const data = await lockIn('');
    setTimeout(() => void writeFile(`${data}.lock`, String(process.ppid)), EMPTY_LOCK_MS / 5);
    await expect(lockDataDir(data)).rejects.toMatchObject({ pid: process.ppid });
  });

  it('an empty lock still empty after the second read is stale and taken over', async () => {
    each();
    const data = await lockIn('');
    const release = await lockDataDir(data);
    expect(await pid(data)).toBe(String(process.pid));
    await release();
  });

  it.each(['\0\0\0\0', 'not-a-pid'])(
    'a lock with the garbage pid %j is broken, not stuck',
    async (text) => {
      each();
      const data = await lockIn(text);
      const release = await lockDataDir(data);
      expect(await pid(data)).toBe(String(process.pid));
      await release();
    }
  );
});

describe('the lock path and an old lock (C2)', () => {
  it('lockDataDir takes the lock it is given, not <dataDir>.lock', async () => {
    const dir = await tempDir('agentage-lock-at-');
    const lock = join(dir, 'run', 'store.lock');
    await mkdir(join(dir, 'run'));
    const release = await lockDataDir(join(dir, 'data'), lock);
    expect(await readFile(lock, 'utf8')).toBe(String(process.pid));
    expect(existsSync(join(dir, 'data.lock'))).toBe(false);
    await release();
    expect(existsSync(lock)).toBe(false);
  });

  it('clearOldLock: none is fine, a dead holder is removed, a live one refuses', async () => {
    const dir = await tempDir('agentage-lock-old-');
    const lock = join(dir, 'data.lock');
    await clearOldLock(lock);
    await writeFile(lock, String(deadPid()));
    await clearOldLock(lock);
    expect(existsSync(lock)).toBe(false);
    await writeFile(lock, String(process.ppid));
    await expect(clearOldLock(lock)).rejects.toMatchObject({ code: DATA_DIR_LOCKED });
    expect(existsSync(lock)).toBe(true);
  });
});
