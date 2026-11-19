import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const fast = (upstreams: Upstream[], fetchImpl?: typeof fetch) =>
  upstreamRunner({
    upstreams,
    intervalMs: 20,
    timeoutMs: 100,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

const startOf = async (upstreams: Upstream[], id: string, fetchImpl?: typeof fetch) => {
  const run = await fast(upstreams, fetchImpl).start({ id } as never);
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
  ])('refuses a row with %s', async (_name, row) => {
    const file = join(await tempDir('agentage-upstreams-'), 'upstreams.json');
    await writeFile(file, JSON.stringify([row]));
    await expect(readUpstreams(file)).rejects.toThrow();
  });
});

describe('the upstream runner (J.4.4 row 1)', () => {
  it('starts nothing: a healthy service is running at its listed address', async () => {
    const s = await service({ status: 200 });
    open.push(s.server);
    const run = await startOf([{ id: 'probe', service: 'probe', address: s.address }], 'probe');
    expect([run.state(), run.address(), run.pid]).toEqual(['running', s.address, 0]);
    expect(run.port).toBe(Number(new URL(s.address).port));
  });

  it('an id with no row is refused, naming the id', async () => {
    await expect(startOf([], 'probe')).rejects.toThrow('no upstream for probe');
  });

  it('picks the service named as the id among two rows of one id', async () => {
    const rows = [
      { id: 'root', service: 'root-pages', address: 'http://pages:8080' },
      { id: 'root', service: 'root', address: 'http://api:8080' },
    ];
    const down = vi.fn(async () => new Response(null, { status: 503 }));
    expect((await startOf(rows, 'root', down)).address()).toBe('http://api:8080');
  });

  it('is down on a 500, a refused port and a hang, and never throws', async () => {
    const bad = await service({ status: 500 });
    const hang = await service({ status: 200, hang: true });
    open.push(bad.server, hang.server);
    const closed = await service({ status: 200 });
    closed.server.close();
    for (const s of [bad, closed, hang]) {
      const run = await startOf([{ id: 'x', service: 'x', address: s.address }], 'x');
      expect(run.state(), s.address).toBe('down');
    }
  });

  it('follows the health of the service: down, then running again', async () => {
    const s = await service({ status: 200 });
    open.push(s.server);
    const run = await startOf([{ id: 'probe', service: 'probe', address: s.address }], 'probe');
    s.health.status = 503;
    await vi.waitFor(() => expect(run.state()).toBe('down'));
    s.health.status = 200;
    await vi.waitFor(() => expect(run.state()).toBe('running'));
  });

  it('stop ends the watch: exited, and no probe after it', async () => {
    const calls = vi.fn(async () => new Response('{}', { status: 200 }));
    const run = await startOf([{ id: 'p', service: 'p', address: 'http://p:8080' }], 'p', calls);
    await run.stop();
    expect(await run.exited).toEqual({ code: null, signal: null });
    const seen = calls.mock.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect([run.state(), calls.mock.calls.length]).toEqual(['exited', seen]);
  });

  it('an https address without a port is port 443', async () => {
    const ok = vi.fn(async () => new Response('{}', { status: 200 }));
    const run = await startOf([{ id: 'p', service: 'p', address: 'https://p.example' }], 'p', ok);
    expect(run.port).toBe(443);
  });
});
