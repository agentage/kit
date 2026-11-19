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

// The market half carries no import: a browser bundle can take it; only logs.send needs the Node events client.
describe('core-client imports', () => {
  const dir = resolve(import.meta.dirname);
  it('the entry reaches the logs package and nothing else', () => {
    expect(externalImports(join(dir, 'index.ts'))).toEqual(['@agentage/logs']);
  });

  it('the market reads reach no package and no node builtin', () => {
    expect(externalImports(join(dir, 'market.ts'))).toEqual([]);
  });
});
