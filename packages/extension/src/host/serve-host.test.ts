import { writeFile } from 'node:fs/promises';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXIT_IN_CREATE,
  hostedPackage,
  NO_STORE_MANIFEST,
} from '../test-support/hosted-fixture.js';
import { rawRequest } from '../test-support/http.js';
import { SHA, tempDir } from '../test-support/packages.js';
import { BIND_REFUSED, hostEnvOf } from './host-env.js';
import { announce, ORPHAN_MS, serveHost, type ServedHost } from './serve-host.js';

const served: ServedHost[] = [];
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  for (const s of served.splice(0)) {
    s.server.close();
    await s.host.stop();
  }
  vi.restoreAllMocks();
});

const secretsDir = async () => {
  const dir = await tempDir('agentage-host-secrets-');
  await writeFile(join(dir, 'api-token'), 'tok-1\n');
  await writeFile(join(dir, 'undeclared'), 'x');
  return dir;
};

const start = async (env: Record<string, string> = {}, dir?: string) => {
  const exit = vi.fn();
  const ready = vi.fn();
  const base = {
    PORT: '0',
    AGENTAGE_EXTENSION_DIR: dir ?? (await hostedPackage()),
    AGENTAGE_SECRETS_DIR: await secretsDir(),
  };
  const s = await serveHost({ ...base, ...env }, { exit, ready, signals: [] });
  served.push(s);
  const { address, port } = (s.server.address() ?? {}) as AddressInfo;
  return { s, exit, ready, address, url: `http://127.0.0.1:${port}`, port };
};

const TOKEN_ENV = {
  AGENTAGE_ISSUER: 'https://127.0.0.1:9',
  AGENTAGE_AUDIENCE: '*.agentage.io',
  AGENTAGE_ORIGIN: 'https://hosted.next.agentage.io',
};

describe('hostEnvOf', () => {
  it('defaults: port 8080, the current folder, loopback, memory store, /run/secrets', () => {
    expect(hostEnvOf({})).toEqual({
      dir: process.cwd(),
      port: 8080,
      bind: '127.0.0.1',
      dataDir: '',
      runDir: '',
      settings: {},
      secretsDir: '/run/secrets',
      origin: 'http://127.0.0.1:8080',
      platform: { issuer: '', audience: '' },
      drainMs: 10_000,
      storeOpenMs: 120_000,
    });
    expect(hostEnvOf({ AGENTAGE_STORE_OPEN_MS: '500' }).storeOpenMs).toBe(500);
    expect(hostEnvOf({ AGENTAGE_STORE_URL_FILE: '/run/secrets/store-url' }).storeUrlFile).toBe(
      '/run/secrets/store-url'
    );
    expect(hostEnvOf({ AGENTAGE_DRAIN_MS: '8000' }).drainMs).toBe(8000);
    expect(hostEnvOf({ AGENTAGE_DRAIN_MS: '-1' }).drainMs).toBe(10_000);
  });
});

describe('serveHost', () => {
  it('binds 127.0.0.1 with no token check, reports its port, serves /health and the api', async () => {
    const settings = { AGENTAGE_SETTINGS: '{"echo.prefix":"hey"}' };
    const { ready, address, url, port } = await start(settings);
    expect(address).toBe('127.0.0.1');
    expect(ready).toHaveBeenCalledWith(port, expect.any(Function));
    expect((await fetch(`${url}/health`)).status).toBe(200);
    const echo = await (await fetch(`${url}/api/hosted/echo?msg=hi`)).json();
    expect(echo).toMatchObject({ data: { msg: 'hey hi', secret: 5, origin: 'http://127.0.0.1' } });
  });

  it('on loopback the guard holds: its own port and the daemon port of AGENTAGE_ORIGIN only', async () => {
    const { port } = await start({ AGENTAGE_ORIGIN: 'http://127.0.0.1:4243' });
    const status = async (headers: Record<string, string>) =>
      (await rawRequest(port, headers, '/api/hosted/echo')).status;
    expect(await status({ host: `127.0.0.1:${port}` })).toBe(200);
    expect(await status({ host: '127.0.0.1:4243', origin: 'http://127.0.0.1:4243' })).toBe(200);
    expect(await status({ host: 'localhost:4243' })).toBe(200);
    expect(await status({ host: '127.0.0.1:4244' })).toBe(403);
    expect(await status({ host: `127.0.0.1:${port}`, origin: 'https://evil.example' })).toBe(403);
    const all = await start({ AGENTAGE_HOST_BIND: 'all', AGENTAGE_HOST_AUTH: 'off' });
    expect((await rawRequest(all.port, { host: 'evil.example' }, '/api/hosted/echo')).status).toBe(
      200
    );
  });

  it('gives ctx.platform the issuer, audience and telemetry of its env, as a part image does', async () => {
    const telemetry = { AGENTAGE_TELEMETRY_URL: 'https://logs.next.agentage.io' };
    const { url } = await start({ ...TOKEN_ENV, ...telemetry });
    const body = (await (await fetch(`${url}/api/hosted/platform`)).json()) as { data: object };
    expect(body.data).toEqual({
      issuer: 'https://127.0.0.1:9',
      audience: '*.agentage.io',
      telemetry: 'https://logs.next.agentage.io',
    });
  });

  it('reports the image COMMIT_SHA and BUILD_TIME on /health', async () => {
    const build = { COMMIT_SHA: SHA, BUILD_TIME: '2026-11-15T10:00:00Z' };
    const { url } = await start(build);
    const health = (await (await fetch(`${url}/health`)).json()) as { data: object };
    expect(health.data).toMatchObject({ commit: SHA, buildTime: '2026-11-15T10:00:00Z' });
  });

  it('keeps the store in AGENTAGE_DATA_DIR across two runs', async () => {
    const dir = await hostedPackage();
    const env = { AGENTAGE_DATA_DIR: await tempDir('agentage-host-data-') };
    const first = await start(env, dir);
    await fetch(`${first.url}/api/hosted/echo`);
    first.s.server.close();
    await first.s.host.stop();
    const second = await start(env, dir);
    const echo = await (await fetch(`${second.url}/api/hosted/echo`)).json();
    expect(echo).toMatchObject({ data: { hits: 2 } });
  });

  it('every address: refused with no token check, served with one, or with AGENTAGE_HOST_AUTH=off', async () => {
    const all = { AGENTAGE_HOST_BIND: 'all' };
    await expect(start(all)).rejects.toThrow(BIND_REFUSED);
    const open = await start({ ...all, AGENTAGE_HOST_AUTH: 'off' });
    expect(open.address).toBe('0.0.0.0');
    expect((await fetch(`${open.url}/api/hosted/echo`)).status).toBe(200);
    const checked = await start({ ...all, ...TOKEN_ENV });
    expect(checked.address).toBe('0.0.0.0');
    expect((await fetch(`${checked.url}/api/hosted/echo`)).status).toBe(401);
  });

  it('stop drains: an open request is answered, then the store closes and it exits 0', async () => {
    const { s, exit, url } = await start();
    const slow = fetch(`${url}/api/hosted/slow`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    s.stop();
    expect((await slow).status).toBe(200);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it('a store close that never ends still exits, after AGENTAGE_DRAIN_MS', async () => {
    const { s, exit } = await start({ AGENTAGE_DRAIN_MS: '150' });
    const stop = s.host.stop;
    s.host.stop = () => new Promise(() => undefined);
    s.stop();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    s.host.stop = stop;
  });

  it('ctx.exit() in a request drains the host the same way', async () => {
    const { exit, url } = await start();
    expect((await fetch(`${url}/api/hosted/exit`)).status).toBe(200);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it('ctx.exit() inside create runs once the server listens', async () => {
    const { exit } = await start({}, await hostedPackage(NO_STORE_MANIFEST, EXIT_IN_CREATE));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
});

describe('announce', () => {
  it('sends the port over IPC; on disconnect drains, and exits after ORPHAN_MS if still there', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const once = vi.spyOn(process, 'once').mockImplementation(() => process);
    const was = process.send;
    process.send = send as typeof process.send;
    const stop = vi.fn();
    const exit = vi.fn() as unknown as typeof process.exit;
    announce(4321, stop, exit);
    process.send = was;
    expect(send).toHaveBeenCalledWith({ type: 'ready', port: 4321 });
    const [event, onGone] = once.mock.calls[0] as [string, () => void];
    expect(event).toBe('disconnect');
    onGone();
    expect(stop).toHaveBeenCalled();
    vi.advanceTimersByTime(ORPHAN_MS);
    expect(exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});
