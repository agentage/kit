import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempDir } from '../test-support/packages.js';
import { deadPid } from '../test-support/processes.js';
import { DATA_DIR_LOCKED, EMPTY_LOCK_MS, lockDataDir } from './data-lock.js';

// A volume with no hard links (some CIFS and FUSE mounts): link fails with EPERM.
const fs = vi.hoisted(() => ({ noLink: false, links: 0 }));
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  const link: typeof real.link = async (from, to) => {
    fs.links += 1;
    if (!fs.noLink) return real.link(from, to);
    throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' });
  };
  return { ...real, link };
});

const lockIn = async (pid: number | '') => {
  const data = join(await tempDir('agentage-lock-'), 'hosted');
  await writeFile(`${data}.lock`, String(pid));
  return data;
};
const pid = async (data: string) => readFile(`${data}.lock`, 'utf8');

describe.each([
  ['hard links', false],
  ['no hard links (exclusive create)', true],
])('lockDataDir with %s', (_name, noLink) => {
  const each = () => Object.assign(fs, { noLink, links: 0 });

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
});
