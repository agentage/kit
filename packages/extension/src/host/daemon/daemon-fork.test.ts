import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { HOSTED_MANIFEST, hostedPackage } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { forkLaunch } from './child.js';

// The built entry: verify builds it (tsc -b) before the tests run.
const MAIN = fileURLToPath(new URL('../../../dist/host/main.js', import.meta.url));
const OTHER = {
  ...HOSTED_MANIFEST,
  agentage: { ...HOSTED_MANIFEST.agentage, id: 'other', parts: { api: true } },
};

let h: Harness;
const echo = async (id: string) => {
  const res = await fetch(`http://127.0.0.1:${h.daemon.port}/api/${id}/echo?msg=hi`);
  return {
    status: res.status,
    body: (await res.json()) as { data?: { msg: string; pid: number } },
  };
};
const alive = (pid: number) => {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
};

beforeAll(async () => {
  if (!existsSync(MAIN)) throw new Error(`${MAIN} is missing: npm run build first`);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  h = await startHarness({ launch: forkLaunch(MAIN) });
  await writeFile(
    join(h.configDir, 'secrets.json'),
    json({ hosted: { 'api-token': 't' }, other: { 'api-token': 't' } })
  );
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
          { id: 'hosted', state: 'failed', error: 'the process exited' },
          { id: 'other', state: 'running' },
        ],
      });
    });
    expect((await echo('other')).status).toBe(200);
    expect((await echo('hosted')).status).toBe(503);
  });

  it('stop ends every child', async () => {
    const { body } = await echo('other');
    await h.daemon.stop();
    expect(alive(body.data!.pid)).toBe(false);
  });
});
