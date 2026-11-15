import { access, readFile, writeFile } from 'node:fs/promises';
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

describe('forkLaunch hand-over', () => {
  it('secrets are 0600 files in a 0700 folder, removed once it started; only the listed env passes', async () => {
    const out = join(await tempDir('agentage-child-'), 'seen.json');
    const main = await script(`
      import { readFileSync, statSync, writeFileSync } from 'node:fs';
      const d = process.env.AGENTAGE_SECRETS_DIR;
      const mode = (p) => statSync(p).mode & 0o777;
      const token = readFileSync(d + '/api-token', 'utf8');
      const seen = { d, dir: mode(d), file: mode(d + '/api-token'), token, keys: Object.keys(process.env) };
      writeFileSync(${JSON.stringify(out)}, JSON.stringify(seen));
      process.send({ type: 'ready', port: 1 });
      setInterval(() => undefined, 1000);
    `);
    process.env['S111_NOT_PASSED'] = 'x';
    try {
      const child = await forkLaunch(main)({ ...SPEC, secrets: { 'api-token': 'tok' } });
      await child.stop();
    } finally {
      delete process.env['S111_NOT_PASSED'];
    }
    const seen = JSON.parse(await readFile(out, 'utf8')) as Record<string, unknown> & { d: string };
    expect(seen).toMatchObject({ dir: 0o700, file: 0o600, token: 'tok' });
    await expect(access(seen.d)).rejects.toMatchObject({ code: 'ENOENT' });
    const allowed =
      /^(PORT|AGENTAGE_.*|NODE_CHANNEL_.*|PATH|HOME|TMPDIR|LANG|NODE_EXTRA_CA_CERTS)$/;
    expect((seen['keys'] as string[]).filter((k) => !allowed.test(k))).toEqual([]);
  });
});
