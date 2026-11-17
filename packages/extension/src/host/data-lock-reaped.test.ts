import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../test-support/packages.js';

vi.mock('node:fs', async (original) => {
  const real = (await original()) as Record<string, unknown> & {
    readFileSync: (...a: unknown[]) => unknown;
  };
  return {
    ...real,
    readFileSync: (file: string, ...rest: never[]) => {
      if (String(file).startsWith('/proc/'))
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return real.readFileSync(file, ...rest);
    },
  };
});

afterEach(() => vi.restoreAllMocks());

describe.runIf(process.platform === 'linux')(
  'a holder reaped between the kill check and /proc',
  () => {
    it('counts as dead: ENOENT on /proc/<pid>/stat is not alive', async () => {
      const { lockDataDir } = await import('./data-lock.js');
      vi.spyOn(process, 'kill').mockImplementation(() => true);
      const data = join(await tempDir(), 'data');
      await writeFile(`${data}.lock`, '999999');
      const release = await lockDataDir(data);
      expect(release).toBeTypeOf('function');
      await release();
    });
  }
);
