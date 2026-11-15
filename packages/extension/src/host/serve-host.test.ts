import { mkdtemp, writeFile } from 'node:fs/promises';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostedPackage } from '../test-support/hosted-fixture.js';
import { readSecretDir, serveHost, type ServedHost } from './serve-host.js';

let served: ServedHost | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  served?.server.close();
  await served?.host.stop();
  vi.restoreAllMocks();
});

const secretsDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentage-host-secrets-'));
  await writeFile(join(dir, 'api-token'), 'tok-1\n');
  return dir;
};

const start = async (env: Record<string, string> = {}) => {
  const exit = vi.fn();
  const ready = vi.fn();
  const dir = await hostedPackage();
  const base = { PORT: '0', AGENTAGE_EXTENSION_DIR: dir, AGENTAGE_SECRETS_DIR: await secretsDir() };
  served = await serveHost({ ...base, ...env }, { exit, ready, signals: [] });
  const { address, port } = served.server.address() as AddressInfo;
  return { exit, ready, address, url: `http://127.0.0.1:${port}`, port };
};

describe('serveHost', () => {
  it('binds 127.0.0.1, reports its port, serves /health and the api with env settings', async () => {
    const { ready, address, url, port } = await start({
      AGENTAGE_SETTINGS: '{"echo.prefix":"hey"}',
    });
    expect(address).toBe('127.0.0.1');
    expect(ready).toHaveBeenCalledWith(port);
    expect((await fetch(`${url}/health`)).status).toBe(200);
    const echo = await (await fetch(`${url}/api/hosted/echo?msg=hi`)).json();
    expect(echo).toMatchObject({ data: { msg: 'hey hi', secret: 5 } });
  });

  it('binds every address only when AGENTAGE_HOST_BIND=all', async () => {
    expect((await start({ AGENTAGE_HOST_BIND: 'all' })).address).toBe('0.0.0.0');
  });

  it('stop drains: an open request is answered, then the store closes and it exits 0', async () => {
    const { exit, url } = await start();
    const slow = fetch(`${url}/api/hosted/slow`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    served!.stop();
    expect((await slow).status).toBe(200);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it('ctx.exit() drains the host the same way', async () => {
    const { exit, url } = await start();
    expect((await fetch(`${url}/api/hosted/exit`)).status).toBe(200);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
});

describe('readSecretDir', () => {
  it('reads one file per name without its newline; a missing folder is no secrets', async () => {
    expect(await readSecretDir(await secretsDir())).toEqual({ 'api-token': 'tok-1' });
    expect(await readSecretDir('/nonexistent/agentage')).toEqual({});
  });
});
