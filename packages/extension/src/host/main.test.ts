import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostedPackage } from '../test-support/hosted-fixture.js';
import { tempDir } from '../test-support/packages.js';
import { seedStore } from '../test-support/pglite-seed.js';
import { BUILT_MAIN as MAIN } from '../test-support/launch-spec.js';

// The built entry: verify builds it (tsc -b) before the tests run.

describe('dist/host/main.js', () => {
  it('reports its port over IPC, answers, and exits 0 on a real SIGTERM', async () => {
    if (!existsSync(MAIN)) throw new Error(`${MAIN} is missing: npm run build first`);
    const secrets = await tempDir();
    await writeFile(join(secrets, 'api-token'), 't');
    const env = {
      PATH: process.env['PATH'],
      PORT: '0',
      AGENTAGE_EXTENSION_DIR: await hostedPackage(),
      AGENTAGE_SECRETS_DIR: secrets,
      AGENTAGE_DATA_DIR: await seedStore(join(await tempDir(), 'store')),
    };
    const child = fork(MAIN, [], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const port = await new Promise<number>((resolve) =>
      child.on('message', (msg) => resolve((msg as { port: number }).port))
    );
    const echo = await (await fetch(`http://127.0.0.1:${port}/api/hosted/echo?msg=hi`)).json();
    expect(echo).toMatchObject({ data: { msg: 'hi', pid: child.pid } });
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
  });
});
