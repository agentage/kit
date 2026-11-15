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
// All three try at one time, then mark it in tries; a taker holds the lock until all three tried.
const RUN = `const { lockDataDir } = await import(process.argv[1]);
const { readdir, writeFile } = await import('node:fs/promises');
const [, , data, tries, n, at] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(Number(at) - Date.now());
const tried = () => writeFile(tries + '/' + n, '');
try { const release = await lockDataDir(data); await tried();
  while ((await readdir(tries)).length < 3) await sleep(10);
  await release(); console.log('took');
} catch (err) { await tried(); console.log(err.code); }`;

const starter = (data: string, tries: string, n: number, at: number) =>
  promisify(execFile)(process.execPath, [
    '--input-type=module',
    '-e',
    RUN,
    LOCK,
    data,
    tries,
    `${n}`,
    `${at}`,
  ]);

describe('three processes on one stale data lock', () => {
  it('one takes it and holds it until the other two tried; they refuse; no file is left', async () => {
    if (!existsSync(LOCK)) throw new Error(`${LOCK} is missing: npm run build first`);
    for (let round = 0; round < 3; round += 1) {
      const data = join(await tempDir('agentage-lock3-'), 'hosted');
      await writeFile(`${data}.lock`, String(deadPid()));
      const tries = await tempDir('agentage-lock3-tries-');
      const at = Date.now() + 1_000;
      const outs = await Promise.all([0, 1, 2].map((n) => starter(data, tries, n, at)));
      const said = outs.map((out) => out.stdout.trim()).sort();
      expect(said).toEqual(['DATA_DIR_LOCKED', 'DATA_DIR_LOCKED', 'took']);
      expect(await readdir(join(data, '..'))).toEqual([]);
    }
  }, 30_000);
});
