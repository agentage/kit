import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { inProcessLaunch } from '../../test-support/in-process-launch.js';
import { mountsPackage } from '../../test-support/mounts-fixture.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const MCP = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('the daemon routes /git/{id} and /connector/{id} to the child (G8)', () => {
  it('a clone request and a connector tools/list reach the child', async () => {
    h = await startHarness({ launch: inProcessLaunch });
    await h.call('POST', '/host/extensions', { source: await mountsPackage() });
    const at = (path: string) => `http://127.0.0.1:${h!.daemon.port}${path}`;
    const refs = await fetch(at('/git/mem/local/default.git/info/refs?service=git-upload-pack'));
    expect([refs.status, await refs.json()]).toEqual([
      200,
      { path: '/local/default.git/info/refs', sub: null, bytes: 0 },
    ]);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const list = await fetch(at('/connector/mem'), { method: 'POST', headers: MCP, body });
    expect(await list.text()).toContain('"name":"search"');
    expect((await fetch(at('/git/none/x.git/info/refs'))).status).toBe(404);
  });
});
