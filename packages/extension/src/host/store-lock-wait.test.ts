import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempDir } from '../test-support/packages.js';
import { DATA_DIR_LOCKED, lockDataDir } from './data-lock.js';
import { lockWithin } from './host-store.js';

// A live process that holds nothing: the pid a lock file names.
const holder = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);

describe('the store open waits for a lock holder that is going away', () => {
  it('takes the lock once the holder exits, inside the open limit', async () => {
    const data = join(await tempDir(), 'data');
    const other = holder();
    await writeFile(`${data}.lock`, String(other.pid));
    const taking = lockWithin(data, 5_000);
    other.kill('SIGKILL');
    const release = await taking;
    expect(readFileSync(`${data}.lock`, 'utf8')).toBe(String(process.pid));
    await release();
  });

  it('a holder still there at the open limit fails as before, naming its pid', async () => {
    const data = join(await tempDir(), 'data');
    const other = holder();
    try {
      await writeFile(`${data}.lock`, String(other.pid));
      const late = lockWithin(data, 300);
      await expect(late).rejects.toMatchObject({ code: DATA_DIR_LOCKED, pid: other.pid });
    } finally {
      other.kill('SIGKILL');
    }
  });
});

// sh forks `cat` on fd 3 and execs into a sleep that never reaps it; the test ends cat after the exec,
// so the exit comes later than the exec (an earlier exit is reaped by sh itself).
const zombieOf = () =>
  new Promise<{ pid: number; parent: ReturnType<typeof spawn> }>((resolve, reject) => {
    const parent = spawn('sh', ['-c', 'cat <&3 >/dev/null & echo $!; exec sleep 30'], {
      stdio: ['ignore', 'pipe', 'inherit', 'pipe'],
    });
    parent.stdout!.once('data', (chunk: Buffer) => {
      const pid = Number(String(chunk));
      let polls = 0;
      const exec = () => {
        if (++polls > 1_000) return reject(new Error('sh never exec-ed into sleep'));
        if (readFileSync(`/proc/${parent.pid}/comm`, 'utf8').trim() !== 'sleep') {
          setTimeout(exec, 5);
          return;
        }
        (parent.stdio[3] as NodeJS.WritableStream).end();
        resolve({ pid, parent });
      };
      exec();
    });
  });

const stateOf = (pid: number) => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
};

describe.runIf(process.platform === 'linux')('a lock held by a zombie (Linux)', () => {
  it('is stale: the zombie holds nothing, the lock is taken over', async () => {
    const { pid, parent } = await zombieOf();
    try {
      await vi.waitFor(() => expect(stateOf(pid)).toBe('Z'), { timeout: 5_000, interval: 20 });
      const data = join(await tempDir(), 'data');
      await writeFile(`${data}.lock`, String(pid));
      const release = await lockDataDir(data);
      expect(readFileSync(`${data}.lock`, 'utf8')).toBe(String(process.pid));
      await release();
    } finally {
      parent.kill('SIGKILL');
    }
  });
});
