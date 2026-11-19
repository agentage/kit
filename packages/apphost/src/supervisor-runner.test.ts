import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostedPackage } from '../../extension/src/test-support/hosted-fixture.js';
import { tempDir } from '../../extension/src/test-support/packages.js';
import { writeValues } from './daemon-files.js';
import { LIMITS } from './limits.js';
import { type Run, type Runner } from './runner.js';
import { startEntry, type Entry, type SupervisorDeps } from './supervisor.js';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

// A service that is no child of this process: it counts the health reads it answers.
const service = async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => (seen.push(req.url ?? ''), res.end('{}')));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { seen, address: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

const runAt = (address: string): Run => ({
  pid: 0,
  port: 0,
  exited: new Promise(() => undefined),
  address: () => address,
  addresses: () => [address],
  state: () => 'running',
  stop: async () => undefined,
});

const setup = async (runner: Runner) => {
  const configDir = await tempDir('agentage-supervisor-');
  await writeValues(configDir, 'secrets', 'hosted', { 'api-token': 'k' });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const deps = { ...LIMITS, configDir, runner, log, origin: () => 'http://h', user: {} };
  const source = await hostedPackage();
  const entry: Entry = {
    id: 'hosted',
    install: { id: 'hosted', source },
    state: 'starting',
    version: '',
  };
  return { deps: deps as unknown as SupervisorDeps, entry };
};

const UPSTREAM_ROW: Entry = {
  id: 'hosted',
  install: { id: 'hosted', version: '1.2.0' },
  state: 'starting',
  version: '',
};

describe('a runner with no package folder (the upstream runner)', () => {
  it('starts with no folder, no manifest and no secret check; the version is the listed one', async () => {
    const { address } = await service();
    const start = vi.fn(async () => runAt(address));
    const { deps } = await setup({ kind: 'upstream', readsPackage: false, start });
    const entry = structuredClone(UPSTREAM_ROW);
    expect(await startEntry(deps, entry)).toBeUndefined();
    expect([entry.state, entry.version, entry.dir]).toEqual(['running', '1.2.0', '']);
  });

  it('the same row through a runner that reads a package fails: there is no folder', async () => {
    const start = vi.fn(async () => runAt('http://127.0.0.1:1'));
    const { deps } = await setup({ kind: 'child', readsPackage: true, start });
    const entry = structuredClone(UPSTREAM_ROW);
    expect(await startEntry(deps, entry)).toBeInstanceOf(Error);
    expect([entry.state, start.mock.calls.length]).toEqual(['failed', 0]);
  });
});

describe('the supervisor runs an extension through the runner it is given (one seam)', () => {
  it('starts with the given runner and checks health at the run address', async () => {
    const { seen, address } = await service();
    const start = vi.fn(async () => runAt(address));
    const { deps, entry } = await setup({ kind: 'upstream', readsPackage: true, start });
    expect(await startEntry(deps, entry)).toBeUndefined();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ id: 'hosted' }));
    expect([entry.state, entry.lane?.child.address(), seen]).toEqual([
      'running',
      address,
      ['/health'],
    ]);
  });

  it('a runner that refuses is a failed start with its words', async () => {
    const start = vi.fn(async () => Promise.reject(new Error('no upstream for hosted')));
    const { deps, entry } = await setup({ kind: 'upstream', readsPackage: true, start });
    expect((await startEntry(deps, entry))?.message).toBe('no upstream for hosted');
    expect([entry.state, entry.error]).toEqual(['failed', 'no upstream for hosted']);
  });
});
