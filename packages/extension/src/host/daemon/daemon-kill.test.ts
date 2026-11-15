import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { tempConfigDir } from '../../test-support/daemon-harness.js';
import { hostedPackage } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';

// The built export: verify builds it (tsc -b) before the tests run.
const HOST = fileURLToPath(new URL('../../../dist/host/index.js', import.meta.url));
const RUN = `const { createDaemon } = await import(process.argv[1]);
await createDaemon({ configDir: process.argv[2], port: 0, version: 't', startedBy: 'test' });`;

const alive = (pid: number) => {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
};

describe('a daemon killed with SIGKILL', () => {
  it('leaves no child, also one with a request that never ends: it sees its IPC channel close', async () => {
    if (!existsSync(HOST)) throw new Error(`${HOST} is missing: npm run build first`);
    const configDir = await tempConfigDir();
    const extensions = [{ id: 'hosted', source: await hostedPackage() }];
    await writeFile(join(configDir, 'installation.json'), json({ host: 'local', extensions }));
    await writeFile(join(configDir, 'secrets.json'), json({ hosted: { 'api-token': 't' } }));
    const args = ['--input-type=module', '-e', RUN, HOST, configDir];
    const daemon = spawn(process.execPath, args, { stdio: 'ignore' });
    let child = 0;
    try {
      child = await vi.waitFor(
        async () => {
          const { port } = JSON.parse(await readFile(join(configDir, 'daemon.json'), 'utf8'));
          const list = await (await fetch(`http://127.0.0.1:${port}/host/extensions`)).json();
          const pid = (list as { data: { pid?: number }[] }).data[0]?.pid;
          if (!pid) throw new Error(`not running yet: ${JSON.stringify(list)}`);
          return pid;
        },
        { timeout: 45_000, interval: 100 }
      );
      const { port } = JSON.parse(await readFile(join(configDir, 'daemon.json'), 'utf8'));
      void fetch(`http://127.0.0.1:${port}/api/hosted/hang`).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 200));
      daemon.kill('SIGKILL');
      await vi.waitFor(() => expect(alive(child)).toBe(false), { timeout: 20_000, interval: 100 });
    } finally {
      // A failed run must not leave the daemon or its child behind.
      daemon.kill('SIGKILL');
      if (child && alive(child)) process.kill(child, 'SIGKILL');
    }
  }, 60_000);
});
