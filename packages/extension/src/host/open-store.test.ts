import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOSTED_MANIFEST } from '../test-support/hosted-fixture.js';
import { recordedLog } from '../test-support/http.js';
import { tempDir } from '../test-support/packages.js';
import { openStore } from './open-store.js';

const SECRET = 'pw-never-logged';
const packageOf = (store: string) =>
  ({
    ...HOSTED_MANIFEST,
    agentage: { ...HOSTED_MANIFEST.agentage, parts: { api: true, store } },
  }) as never;

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => (s.closeAllConnections(), s.close())));

// A store that accepts the call and never answers.
const silentUrl = async () => {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return `http://u:${SECRET}@127.0.0.1:${(server.address() as AddressInfo).port}/db`;
};

const fileWith = async (text: string) => {
  const file = join(await tempDir(), 'store-url');
  await writeFile(file, text);
  return file;
};

describe('openStore refusals', () => {
  it('a kind with no opener here (signoz) keeps the start and warns once', async () => {
    const { log, lines } = recordedLog();
    const at = {
      dir: '/x',
      dataDir: '',
      openMs: 100,
      file: await fileWith(`http://u:${SECRET}@h`),
    };
    expect(await openStore(packageOf('signoz'), at, log)).toBeUndefined();
    expect(lines).toMatchObject([{ level: 'warn', msg: expect.stringMatching(/unused$/) }]);
    expect(JSON.stringify(lines)).not.toContain(SECRET);
  });

  it.each(['postgres', 'clickhouse', 'git'])(
    'a %s package with an unreadable, empty or malformed file refuses, naming the file',
    async (kind) => {
      const dir = await tempDir();
      const bad = [dir, await fileWith(' '), await fileWith(`${SECRET} not a url`)];
      for (const file of bad) {
        const at = { dir, dataDir: join(dir, 'data'), openMs: 100, file };
        const err = await openStore(packageOf(kind), at, recordedLog().log).catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain(`AGENTAGE_STORE_URL_FILE ${file}`);
        expect((err as Error).message).not.toContain(SECRET);
      }
    }
  );

  it('a store that never answers: the start is bounded by openMs, the warning names no URL', async () => {
    const { log, lines } = recordedLog();
    const dir = await tempDir();
    await mkdir(join(dir, 'migrations'));
    const at = { dir, dataDir: '', openMs: 150, file: await fileWith(await silentUrl()) };
    const store = await openStore(packageOf('clickhouse'), at, log);
    expect(store?.kind).toBe('clickhouse');
    expect(lines).toMatchObject([{ level: 'warn', reason: 'not in 150 ms' }]);
    expect(JSON.stringify(lines)).not.toContain(SECRET);
  });
});
