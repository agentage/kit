import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import {
  HOSTED_MANIFEST,
  hostedPackage,
  NO_STORE_MANIFEST,
} from '../../test-support/hosted-fixture.js';
import { seedStore } from '../../test-support/pglite-seed.js';
import { alive } from '../../test-support/processes.js';
import { forkLaunch } from './child.js';
import { dataDirOf } from './daemon-files.js';

// The built entry: verify builds it (tsc -b) before the tests run.
const MAIN = fileURLToPath(new URL('../../../dist/host/main.js', import.meta.url));
const OTHER = { ...NO_STORE_MANIFEST, agentage: { ...NO_STORE_MANIFEST.agentage, id: 'other' } };

let h: Harness;
const echo = async (id: string) => {
  const res = await fetch(`http://127.0.0.1:${h.daemon.port}/api/${id}/echo?msg=hi`);
  return {
    status: res.status,
    body: (await res.json()) as { data?: { msg: string; pid: number } },
  };
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  if (!existsSync(MAIN)) throw new Error(`${MAIN} is missing: npm run build first`);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  // A request counted on the old child before the swap is answered there: drainMs covers a busy CI.
  h = await startHarness({ launch: forkLaunch(MAIN), drainMs: 2_000 });
  await writeSecrets(h.configDir, ['hosted', 'other']);
  await seedStore(dataDirOf(h.configDir, 'hosted'));
  await h.call('POST', '/host/extensions', { source: await hostedPackage() });
  await h.call('POST', '/host/extensions', { source: await hostedPackage(OTHER) });
});
afterAll(async () => {
  await h.daemon.stop();
  vi.restoreAllMocks();
});

describe('daemon with child processes', () => {
  it('runs each extension in its own process, and swaps one under 60 requests with none lost', async () => {
    const [a, b] = [await echo('hosted'), await echo('other')];
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(new Set([process.pid, a.body.data?.pid, b.body.data?.pid]).size).toBe(3);
    type Row = { id: string; pid?: number };
    const rows = ((await h.call('GET', '/host/extensions')).body as { data: Row[] }).data;
    const health = (await h.call('GET', '/health')).body as { extensions: Row[] };
    const pids = [a.body.data?.pid, b.body.data?.pid];
    expect([rows, health.extensions].map((list) => list.map((r) => r.pid))).toEqual([pids, pids]);
    const change = h.call('PATCH', '/host/extensions/other', {
      settings: { 'echo.prefix': 'hey' },
    });
    const answers = await Promise.all(
      Array.from(
        { length: 60 },
        async (_, i) => (await new Promise((r) => setTimeout(r, i * 5)), echo('other'))
      )
    );
    expect((await change).status).toBe(200);
    expect(answers.filter((r) => r.status !== 200)).toEqual([]);
    expect((await echo('other')).body.data?.msg).toBe('hey hi');
    expect(alive(b.body.data!.pid)).toBe(false);
  });

  it('a request sent during the swap is held, then served by the new child with the new settings', async () => {
    const old = (await echo('other')).body.data!.pid;
    // /slow ends at 300 ms, then the new child starts: an echo at ~230 ms finds the gate held.
    const slow = fetch(`http://127.0.0.1:${h.daemon.port}/api/other/slow`);
    await pause(30);
    const change = h.call('PATCH', '/host/extensions/other', {
      settings: { 'echo.prefix': 'new' },
    });
    await pause(200);
    const held = await echo('other');
    expect((await slow).status).toBe(200);
    expect((await change).status).toBe(200);
    expect(held.body.data).toMatchObject({ msg: 'new hi' });
    expect(held.body.data!.pid).not.toBe(old);
  });

  it('a request that never ends holds neither the swap nor the next change (drainMs, then SIGKILL)', async () => {
    const hung = fetch(`http://127.0.0.1:${h.daemon.port}/api/other/hang`).then((r) => r.status);
    await pause(30);
    const started = Date.now();
    const change = await h.call('PATCH', '/host/extensions/other', {
      settings: { 'echo.prefix': 'a' },
    });
    expect(change.status).toBe(200);
    expect(await hung).toBe(503);
    // drainMs (2 s), the SIGKILL after 5 s, and the start of the new child.
    expect(Date.now() - started).toBeLessThan(10_000);
    const next = await h.call('PATCH', '/host/extensions/other', {
      settings: { 'echo.prefix': 'b' },
    });
    expect([next.status, (await echo('other')).body.data?.msg]).toEqual([200, 'b hi']);
  }, 20_000);

  it('a child that refuses to start is failed with its own reason', async () => {
    const lone = { ...HOSTED_MANIFEST, agentage: { ...HOSTED_MANIFEST.agentage, id: 'lone' } };
    const added = await h.call('POST', '/host/extensions', { source: await hostedPackage(lone) });
    const error = 'api refused to start: secret api-token has no value';
    expect(added.body).toMatchObject({ data: { id: 'lone', state: 'failed', error } });
    await h.call('DELETE', '/host/extensions/lone');
  });

  it('a killed child is failed in the list and /health; the other still answers', async () => {
    const { body } = await echo('hosted');
    process.kill(body.data!.pid, 'SIGKILL');
    await vi.waitFor(async () => {
      const health = (await h.call('GET', '/health')).body;
      expect(health).toMatchObject({
        status: 'degraded',
        extensions: [
          { id: 'hosted', state: 'failed', error: 'the process exited (signal SIGKILL)' },
          { id: 'other', state: 'running' },
        ],
      });
    });
    expect((await echo('other')).status).toBe(200);
    expect((await echo('hosted')).status).toBe(503);
  });

  it('a child that exits with a code is failed with "(code N)" in the list and /health', async () => {
    const crash = { ...OTHER, agentage: { ...OTHER.agentage, id: 'crash' } };
    await writeSecrets(h.configDir, ['hosted', 'other', 'crash']);
    await h.call('POST', '/host/extensions', { source: await hostedPackage(crash) });
    expect((await echo('crash')).status).toBe(200);
    await fetch(`http://127.0.0.1:${h.daemon.port}/api/crash/crash`);
    const error = 'the process exited (code 3)';
    await vi.waitFor(async () => {
      const health = (await h.call('GET', '/health')).body;
      expect(health).toMatchObject({
        extensions: [{}, {}, { id: 'crash', state: 'failed', error }],
      });
    });
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({
      data: [{}, {}, { id: 'crash', state: 'failed', error }],
    });
    await h.call('DELETE', '/host/extensions/crash');
  });

  it('stop ends every child, also one with a request that never ends', async () => {
    const { body } = await echo('other');
    const hung = fetch(`http://127.0.0.1:${h.daemon.port}/api/other/hang`).then((r) => r.status);
    await pause(30);
    await h.daemon.stop();
    expect(alive(body.data!.pid)).toBe(false);
    expect(await hung).toBe(503);
  }, 20_000);
});
