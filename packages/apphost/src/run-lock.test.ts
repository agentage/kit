import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../extension/src/test-support/packages.js';
import { clearRunLock } from './run-lock.js';

const runFolder = async () => {
  const runDir = join(await tempDir('agentage-runlock-'), 'run', 'probe');
  await mkdir(runDir, { recursive: true });
  return { runDir, lock: join(runDir, 'store.lock') };
};

// A process that lives with AGENTAGE_RUN_DIR set as given (an old child still draining).
const sleeper = (runDir?: string) =>
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env: { ...process.env, ...(runDir && { AGENTAGE_RUN_DIR: runDir }) },
    stdio: 'ignore',
  });

describe.runIf(process.platform === 'linux')('a left-over run/{id}/store.lock (C2)', () => {
  it('a dead holder is removed; none is fine', async () => {
    const { runDir, lock } = await runFolder();
    await clearRunLock(lock, runDir);
    await writeFile(lock, '999999999');
    await clearRunLock(lock, runDir);
    expect(existsSync(lock)).toBe(false);
  });

  it('a reused pid (a live process that is no child of this id) is removed', async () => {
    const { runDir, lock } = await runFolder();
    const other = sleeper();
    try {
      await writeFile(lock, String(other.pid));
      await clearRunLock(lock, runDir);
      expect(existsSync(lock)).toBe(false);
    } finally {
      other.kill();
    }
  });

  it('a live child of this run folder keeps its lock', async () => {
    const { runDir, lock } = await runFolder();
    const child = sleeper(runDir);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(lock, String(child.pid));
      await clearRunLock(lock, runDir);
      expect(existsSync(lock)).toBe(true);
    } finally {
      child.kill();
    }
  });
});
