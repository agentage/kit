import { createServer as createTlsServer } from 'node:https';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudDiscovery, EVERY_MS, headersOf, READ_MS } from './cloud-discovery.js';
import { readDocument } from './document-read.js';
import { type Entries } from './entries.js';
import { type Lane } from './lane.js';
import { tempDir } from '../../extension/src/test-support/packages.js';
import { entriesOf, startRuns } from './cloud-run.js';
import {
  closeUpstreams,
  docOf,
  OWN,
  OWN_HOST,
  quietLog,
  upstream,
} from './test-support/cloud-upstream.js';

afterEach(closeUpstreams);

// One supervisor entry whose run gives this address, as the upstream runner does.
const entriesAt = (id: string, address: string): Entries => {
  const lane = { child: { addresses: () => [address] } } as unknown as Lane;
  return new Map([[id, { id, install: { id }, state: 'running', version: '1.0.0', lane }]]);
};

describe('through the supervisor and the upstream runner (J.4.3 one seam)', () => {
  it('rows and addresses from the runner, state from discovery; a row with no upstream is refused by the runner', async () => {
    const up = await upstream(docOf('echo'));
    up.health = 500;
    const extensions = [
      { id: 'echo', version: '1.0.0' },
      { id: 'lost', version: '1.0.0' },
    ];
    const upstreams = [{ id: 'echo', service: 'echo', address: up.address }];
    const files = { installation: { host: 'site', extensions }, upstreams };
    const entries = entriesOf(files);
    const log = quietLog();
    const d = createCloudDiscovery({ ...files, entries, own: OWN, log, onChange: vi.fn() });
    const installationFile = join(await tempDir('agentage-cloud-'), 'installation.json');
    const stop = await startRuns({ files, installationFile, own: OWN, log, discovery: d }, entries);
    await d.refresh();
    const states = d.current().document.extensions.map((e) => [e.id, e.state]);
    expect(states).toEqual([
      ['echo', 'running'],
      ['lost', 'starting'],
    ]);
    expect(entries.get('lost')?.error).toBe('no upstream for lost in the upstream list');
    expect([entries.get('echo')?.lane?.child.state(), up.healthReads]).toEqual(['running', 0]);
    await stop();
    expect(entries.get('echo')?.lane).toBeUndefined();
  });
});

describe('the read every interval (5 s in the image)', () => {
  it('start reads at once, then every interval with no refresh call; stop ends it', async () => {
    const up = await upstream(docOf('echo'));
    const installation = { host: 'site', extensions: [{ id: 'echo', version: '1.0.0' }] };
    const entries = entriesAt('echo', up.address);
    const onChange = vi.fn();
    const d = createCloudDiscovery({
      installation,
      entries,
      own: OWN,
      log: quietLog(),
      onChange,
      everyMs: 30,
    });
    await d.start();
    up.doc = undefined;
    await vi.waitFor(() => expect(d.current().document.extensions[0]?.state).toBe('down'));
    d.stop();
    expect([onChange.mock.calls.length, EVERY_MS, READ_MS, up.healthReads]).toEqual([
      2, 5_000, 3_000, 0,
    ]);
  });
});

describe('readDocument: an answer from outside the host', () => {
  const body = (status: number, text: string, wait = 0) =>
    upstream(undefined).then((up) => {
      up.custom = (_req, res) => {
        const send = () => res.writeHead(status).end(text);
        if (wait) setTimeout(send, wait);
        else send();
        return true;
      };
      return up.address;
    });

  it.each([
    ['a 500', 500, '{}', 0],
    ['a body that is not JSON', 200, '<html>', 0],
    ['a body over 256 KiB', 200, JSON.stringify({ pad: 'x'.repeat(300 * 1024) }), 0],
    ['an answer slower than the read time', 200, '{}', 400],
  ])('%s is no document', async (_n, status, text, wait) => {
    expect(await readDocument(await body(status, text, wait), 100)).toBeUndefined();
  });

  it('a closed port is no document', async () => {
    expect(await readDocument('http://127.0.0.1:1', 500)).toBeUndefined();
  });
});

describe('createCloudDiscovery: one read at a time, read as the edge asks', () => {
  it('reads with the Host and x-forwarded-proto of AGENTAGE_URL; parallel refreshes share one read', async () => {
    const up = await upstream(docOf('echo'));
    const hosts: (string | undefined)[] = [];
    up.server.prependListener('request', (req: { headers: Record<string, string> }) =>
      hosts.push(`${req.headers['host']} ${req.headers['x-forwarded-proto']}`)
    );
    const installation = { host: 'site', extensions: [{ id: 'echo', version: '1.0.0' }] };
    const onChange = vi.fn();
    const entries = entriesAt('echo', up.address);
    const d = createCloudDiscovery({
      installation,
      entries,
      own: OWN,
      log: quietLog(),
      onChange,
    });
    await Promise.all([d.refresh(), d.refresh(), d.refresh()]);
    expect(hosts).toEqual([`${OWN_HOST} https`]);
    expect(headersOf(`${OWN}/`)).toEqual({ host: OWN_HOST, 'x-forwarded-proto': 'https' });
    expect(onChange).toHaveBeenCalledTimes(1);
    await d.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('an https row is named by its address in SNI, never by the Host of AGENTAGE_URL', async () => {
    const names: string[] = [];
    const tls = createTlsServer({
      SNICallback: (name, done) => (names.push(name), done(new Error('x'))),
    });
    tls.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve) => tls.listen(0, '127.0.0.1', resolve));
    const address = `https://localhost:${(tls.address() as AddressInfo).port}`;
    expect(await readDocument(address, 500)).toBeUndefined();
    expect(names).toEqual(['localhost']);
    tls.close();
  });

  it('the run state the upstream runner gives is a view of the discovery state', async () => {
    const up = await upstream(docOf('echo'));
    const installation = { host: 'site', extensions: [{ id: 'echo', version: '1.0.0' }] };
    const entries = entriesAt('echo', up.address);
    const d = createCloudDiscovery({
      installation,
      entries,
      own: OWN,
      log: quietLog(),
      onChange: vi.fn(),
    });
    expect([d.stateOf('echo'), d.stateOf('nobody')]).toEqual(['down', 'down']);
    await d.refresh();
    expect(d.stateOf('echo')).toBe('running');
    up.health = 500;
    up.doc = undefined;
    await d.refresh();
    expect([d.stateOf('echo'), up.healthReads]).toEqual(['down', 0]);
  });

  it('a refresh that throws is logged and never stops the host', async () => {
    const up = await upstream(docOf('echo'));
    const installation = { host: 'site', extensions: [{ id: 'echo', version: '1.0.0' }] };
    const entries = entriesAt('echo', up.address);
    const log = { ...quietLog(), warn: vi.fn() };
    const onChange = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw new Error('feed broke');
      });
    const d = createCloudDiscovery({ installation, entries, own: OWN, log, onChange });
    await d.refresh();
    up.doc = undefined;
    await d.refresh();
    expect(log.warn).toHaveBeenCalledWith('discovery refresh failed', { reason: 'feed broke' });
    expect(d.current().document.extensions[0]?.state).toBe('down');
  });
});
