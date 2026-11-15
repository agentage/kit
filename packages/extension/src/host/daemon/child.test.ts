import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../test-support/packages.js';
import { forkLaunch } from './child.js';

const SPEC = {
  id: 'x',
  dir: '/x',
  dataDir: '/x',
  settings: {},
  secrets: {},
  origin: 'http://127.0.0.1',
};

const script = async (body: string) => {
  const file = join(await tempDir('agentage-child-'), 'main.mjs');
  await writeFile(file, body);
  return file;
};

beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));

describe('forkLaunch refusals', () => {
  it('a child that exits before its port and prints nothing: "exited with code N"', async () => {
    const main = await script('process.exit(3);');
    await expect(forkLaunch(main)(SPEC)).rejects.toThrow('exited with code 3');
  });

  it('a child killed by a signal before its port: "exited with signal S"', async () => {
    const main = await script("process.kill(process.pid, 'SIGTERM');");
    await expect(forkLaunch(main)(SPEC)).rejects.toThrow('exited with signal SIGTERM');
  });

  it('a child that reports no port in startMs is killed and says so', async () => {
    const main = await script('setInterval(() => undefined, 1000);');
    await expect(forkLaunch(main, 200)(SPEC)).rejects.toThrow('reported no port in 200 ms: killed');
  });

  it('its last log row is the reason', async () => {
    const row = JSON.stringify({ msg: 'Error: secret api-token has no value' });
    const main = await script(`console.error(${JSON.stringify(row)}); process.exit(1);`);
    await expect(forkLaunch(main)(SPEC)).rejects.toThrow(/^secret api-token has no value$/);
  });
});
