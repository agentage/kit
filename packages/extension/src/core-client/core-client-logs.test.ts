import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closedPort, json, startStub } from '../test-support/core-stub.js';
import { externalImports } from '../test-support/import-graph.js';
import { createCoreClient } from './core-client.js';

const ROW = { kind: 'log' as const, msg: 'a', extension: 'x', part: 'y' };

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

describe('core-client logs.send', () => {
  it('posts the rows with the bearer to the logs ingest', async () => {
    const auth: (string | undefined)[] = [];
    const stub = await startStub((req, res) => {
      auth.push(req.headers.authorization);
      json(200, { data: { accepted: 1, rejected: 0 } })(req, res);
    });
    stops.push(stub.close);
    const answer = await createCoreClient({ url: stub.url, token: 't' }).logs.send([ROW]);
    expect(answer).toEqual({ data: { accepted: 1, rejected: 0 }, down: null });
    expect(stub.hits).toEqual(['POST /api/logs/events']);
    expect(auth).toEqual(['Bearer t']);
  });

  it('two failed sends give one warning; a send that goes through ends the outage', async () => {
    let up = false;
    const stub = await startStub((req, res) =>
      json(up ? 200 : 500, { data: { accepted: 1, rejected: 0 } })(req, res)
    );
    stops.push(stub.close);
    const warnings: string[] = [];
    const client = createCoreClient({ url: stub.url, token: 't', warn: (m) => warnings.push(m) });
    await client.logs.send([ROW]);
    await client.logs.send([ROW]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^logs not reachable: .*rows dropped$/);
    up = true;
    await client.logs.send([ROW]);
    up = false;
    await client.logs.send([ROW]);
    expect(warnings).toHaveLength(2);
  });

  it('no token: the send is dropped, nothing is posted', async () => {
    const stub = await startStub(json(200, {}));
    stops.push(stub.close);
    const answer = await createCoreClient({ url: stub.url, warn: () => undefined }).logs.send([
      ROW,
    ]);
    expect(answer).toMatchObject({ data: null, down: { code: 'no_token' } });
    expect(stub.hits).toEqual([]);
  });

  it('a token never goes over plain http to another machine', async () => {
    const client = createCoreClient({
      url: 'http://core.example',
      token: 't',
      warn: () => undefined,
    });
    const answer = await client.logs.send([ROW]);
    expect(answer.down).toMatchObject({ code: 'refused' });
  });

  it.each([
    'http://localhost:1',
    'http://core.localhost:1',
    'http://127.1.2.3:1',
    'http://[::1]:1',
    'http://[::ffff:127.0.0.1]:1',
  ])('%s is this machine: the token may go there', async (url) => {
    const answer = await createCoreClient({ url, token: 't', warn: () => undefined }).logs.send([
      ROW,
    ]);
    expect(answer.down?.code).not.toBe('refused');
  });

  it('a warn that throws does not make the send reject', async () => {
    const warn = () => {
      throw new Error('broken sink');
    };
    const answer = await createCoreClient({ url: '', token: 't', warn }).logs.send([ROW]);
    expect(answer).toMatchObject({ data: null, down: { code: 'no_core' } });
  });

  it('a send with no token is a logs reason only: the market is not down', async () => {
    const client = createCoreClient({ url: 'https://core.example', warn: () => undefined });
    const answer = await client.logs.send([ROW]);
    expect(answer.down).toMatchObject({ code: 'no_token', message: 'logs needs a token' });
    expect(client.logs.down()).toBe(answer.down);
    expect(client.market.down()).toBeNull();
  });

  it('a closed core with the default warning prints one line', async () => {
    const url = await closedPort();
    const lines: unknown[] = [];
    const warn = console.warn;
    console.warn = (line: unknown) => lines.push(line);
    try {
      await createCoreClient({ url, token: 't' }).logs.send([ROW]);
    } finally {
      console.warn = warn;
    }
    expect(lines).toHaveLength(1);
  });
});

// ./core is Node-only through the events client; the market half imports nothing, so a market-only entry is a split away.
describe('core-client imports', () => {
  const dir = resolve(import.meta.dirname);
  it('the entry reaches the logs package and nothing else', () => {
    expect(externalImports(join(dir, 'index.ts'))).toEqual(['@agentage/logs']);
  });

  it('the market reads reach no package and no node builtin', () => {
    expect(externalImports(join(dir, 'market.ts'))).toEqual([]);
  });
});
