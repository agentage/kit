import type * as Fs from 'node:fs/promises';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempDir } from '../test-support/packages.js';
import { deadPid } from '../test-support/processes.js';

const hook = vi.hoisted(() => ({ lock: '', reads: 0, other: undefined as boolean | undefined }));
const enoent = () => Object.assign(new Error('gone'), { code: 'ENOENT' });

// Another process takes the lock: an exclusive create, as its link would be.
const otherTakes = () =>
  writeFile(hook.lock, '1', { flag: 'wx' }).then(
    () => true,
    () => false
  );

// Read 1: a breaker removed the stale lock. Read 2: it is still gone, then the breaker takes it.
vi.mock('node:fs/promises', async (original) => {
  const real = (await original()) as typeof Fs;
  return {
    ...real,
    readFile: async (file: string, ...rest: never[]) => {
      if (file !== hook.lock) return real.readFile(file, ...rest);
      hook.reads += 1;
      if (hook.reads === 1) await real.unlink(hook.lock);
      if (hook.reads === 2) hook.other = await otherTakes();
      if (hook.reads <= 2) throw enoent();
      return real.readFile(file, ...rest);
    },
  };
});

describe('a stale lock removed by another breaker while this one reads it', () => {
  it('is taken by one process only: a missing lock is never broken', async () => {
    const { lockDataDir } = await import('./data-lock.js');
    const data = join(await tempDir(), 'data');
    hook.lock = `${data}.lock`;
    await writeFile(hook.lock, String(deadPid()));
    const release = await lockDataDir(data).catch(() => undefined);
    const other = hook.other ?? (await otherTakes());
    expect([release !== undefined, other].filter(Boolean)).toHaveLength(1);
    await release?.();
    await unlink(hook.lock).catch(() => undefined);
  });
});
