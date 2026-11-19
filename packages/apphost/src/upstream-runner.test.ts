import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../extension/src/test-support/packages.js';
import { type Run } from './runner.js';
import { readUpstreams, upstreamRunner, type Upstream } from './upstream-runner.js';

// A stand-in service: /health answers `status`; `hang` never answers.
const service = async (health: { status: number; hang?: boolean }) => {
  const server: Server = createServer((req, res) => {
    if (health.hang) return;
    res.writeHead(req.url === '/health' ? health.status : 404).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, address, health };
};

const open: Array<{ close: () => void }> = [];
const runs: Run[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.stop()));
  open.splice(0).forEach((s) => s.close());
});

const startOf = async (
  upstreams: Upstream[],
  id: string,
  state: { now: 'running' | 'down' } = { now: 'running' }
) => {
  const run = await upstreamRunner({ upstreams, stateOf: () => state.now }).start({ id } as never);
  runs.push(run);
  return run;
};

describe('the upstream list', () => {
  it('reads the rows of upstreams.json', async () => {
    const file = join(await tempDir('agentage-upstreams-'), 'upstreams.json');
    const rows = [{ id: 'probe', service: 'probe', address: 'http://probe:8080' }];
    await writeFile(file, JSON.stringify(rows));
    expect(await readUpstreams(file)).toEqual(rows);
  });

  it.each([
    ['no address', { id: 'probe', service: 'probe' }],
    ['an id that is not an id', { id: 'Probe!', service: 'probe', address: 'http://p:1' }],
    ['an address that is not http', { id: 'probe', service: 'probe', address: 'file:///x' }],
    ['an extra key', { id: 'probe', service: 'probe', address: 'http://p:1', token: 'x' }],
    ['a trailing slash', { id: 'probe', service: 'probe', address: 'http://p:1/' }],
    ['a path', { id: 'probe', service: 'probe', address: 'http://p:1/api' }],
    ['a user and password', { id: 'probe', service: 'probe', address: 'http://u:pw@p:1' }],
    ['a query', { id: 'probe', service: 'probe', address: 'http://p:1?x=1' }],
  ])('refuses a row with %s', async (_name, row) => {
    const file = join(await tempDir('agentage-upstreams-'), 'upstreams.json');
    await writeFile(file, JSON.stringify([row]));
    await expect(readUpstreams(file)).rejects.toThrow();
  });

  it('keeps an origin with the default port as written', async () => {
    const file = join(await tempDir('agentage-upstreams-'), 'upstreams.json');
    const rows = [{ id: 'p', service: 'p', address: 'http://p:80' }];
    await writeFile(file, JSON.stringify(rows));
    expect(await readUpstreams(file)).toEqual(rows);
  });

  it.each([
    ['an object', '{"id":"probe"}', 'expected array'],
    ['text that is not JSON', 'not json', 'JSON'],
  ])('refuses a file that holds %s', async (_name, text, words) => {
    const file = join(await tempDir('agentage-upstreams-'), 'upstreams.json');
    await writeFile(file, text);
    await expect(readUpstreams(file)).rejects.toThrow(words);
  });

  it('refuses a missing file', async () => {
    const file = join(await tempDir('agentage-upstreams-'), 'upstreams.json');
    await expect(readUpstreams(file)).rejects.toThrow('ENOENT');
  });
});

describe('the upstream runner (J.4.4 row 1)', () => {
  it('starts nothing and reads no /health: the run is at its listed address, its state from discovery', async () => {
    const s = await service({ status: 500 });
    open.push(s.server);
    const seen: string[] = [];
    s.server.on('request', (req: { url?: string }) => seen.push(req.url ?? ''));
    const state = { now: 'running' as 'running' | 'down' };
    const run = await startOf(
      [{ id: 'probe', service: 'probe', address: s.address }],
      'probe',
      state
    );
    expect([run.state(), run.address(), run.pid]).toEqual(['running', s.address, 0]);
    state.now = 'down';
    expect([run.state(), run.port, seen]).toEqual(['down', Number(new URL(s.address).port), []]);
  });

  it('an id with no row is refused, naming the id', async () => {
    await expect(startOf([], 'probe')).rejects.toThrow('no upstream for probe');
  });

  it('keeps every row of an id in list order', async () => {
    const rows = [
      { id: 'site', service: 'site', address: 'http://site:8080' },
      { id: 'site', service: 'site-pages', address: 'http://site-pages:8080' },
      { id: 'other', service: 'other', address: 'http://other:8080' },
    ];
    const run = await startOf(rows, 'site');
    expect(run.addresses()).toEqual(['http://site:8080', 'http://site-pages:8080']);
    expect(run.address()).toBe('http://site:8080');
  });

  it('stop: exited, whatever discovery says', async () => {
    const run = await startOf([{ id: 'p', service: 'p', address: 'http://p:8080' }], 'p');
    await run.stop();
    expect([await run.exited, run.state()]).toEqual([{ code: null, signal: null }, 'exited']);
  });

  it('an https address without a port is port 443', async () => {
    const run = await startOf([{ id: 'p', service: 'p', address: 'https://p.example' }], 'p');
    expect(run.port).toBe(443);
  });
});
