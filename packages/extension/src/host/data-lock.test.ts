import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test-support/packages.js';
import { deadPid } from '../test-support/processes.js';
import { DATA_DIR_LOCKED, lockDataDir } from './data-lock.js';

const lockIn = async (pid: number) => {
  const data = join(await tempDir('agentage-lock-'), 'hosted');
  await writeFile(`${data}.lock`, String(pid));
  return data;
};
const pid = async (data: string) => readFile(`${data}.lock`, 'utf8');

describe('lockDataDir', () => {
  it('takes over the lock of a dead holder', async () => {
    const data = await lockIn(deadPid());
    const release = await lockDataDir(data);
    expect(await pid(data)).toBe(String(process.pid));
    await release();
  });

  it('takes over a lock with our own pid that this process does not hold (pid 1 in a container)', async () => {
    const data = await lockIn(process.pid);
    const release = await lockDataDir(data);
    await expect(lockDataDir(data)).rejects.toMatchObject({ code: DATA_DIR_LOCKED });
    await release();
    expect((await lockDataDir(data)) instanceof Function).toBe(true);
  });

  it('refuses a live holder', async () => {
    const data = await lockIn(process.ppid);
    await expect(lockDataDir(data)).rejects.toMatchObject({ code: DATA_DIR_LOCKED });
    expect(await pid(data)).toBe(String(process.ppid));
  });

  it('two starts on one stale lock: one takes it, the other refuses, no file is left aside', async () => {
    const data = await lockIn(deadPid());
    const results = await Promise.allSettled([lockDataDir(data), lockDataDir(data)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: DATA_DIR_LOCKED },
    });
    const left = await readdir(join(data, '..'));
    expect(left).toEqual(['hosted.lock']);
  });
});
