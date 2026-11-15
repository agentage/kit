import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test-support/packages.js';
import { deadPid } from '../test-support/processes.js';

// The built lock: verify builds it (tsc -b) before the tests run.
const LOCK = fileURLToPath(new URL('../../dist/host/data-lock.js', import.meta.url));
// Each process waits for one start time, takes the lock or not, holds it 500 ms, says which.
const RUN = `const { lockDataDir } = await import(process.argv[1]);
await new Promise((r) => setTimeout(r, Number(process.argv[3]) - Date.now()));
try { const release = await lockDataDir(process.argv[2]);
  await new Promise((r) => setTimeout(r, 500)); await release(); console.log('took');
} catch (err) { console.log(err.code); }`;

const starter = (data: string, at: number) =>
  promisify(execFile)(process.execPath, ['--input-type=module', '-e', RUN, LOCK, data, `${at}`]);

describe('three processes on one stale data lock', () => {
  it('one takes it, two refuse, and no file is left; three rounds', async () => {
    if (!existsSync(LOCK)) throw new Error(`${LOCK} is missing: npm run build first`);
    for (let round = 0; round < 3; round += 1) {
      const data = join(await tempDir('agentage-lock3-'), 'hosted');
      await writeFile(`${data}.lock`, String(deadPid()));
      const at = Date.now() + 1_000;
      const outs = await Promise.all([0, 1, 2].map(() => starter(data, at)));
      const said = outs.map((out) => out.stdout.trim()).sort();
      expect(said).toEqual(['DATA_DIR_LOCKED', 'DATA_DIR_LOCKED', 'took']);
      expect(await readdir(join(data, '..'))).toEqual([]);
    }
  }, 30_000);
});
