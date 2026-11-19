import { afterEach, describe, expect, it } from 'vitest';
import {
  closedPort,
  json,
  silent,
  startStub,
  text,
  type Handler,
} from '../test-support/core-stub.js';
import { createCoreClient, type CoreClient } from './core-client.js';
import type { CoreCode } from './reason.js';

const ROW = { kind: 'log' as const, msg: 'a', extension: 'x', part: 'y' };
const BOUND_MS = 2_500;

// Each core service: its call and the typed empty answer it gives when the core is silent.
const SERVICES = [
  { name: 'market.latest', call: (c: CoreClient) => c.market.latest('probe'), empty: null },
  {
    name: 'market.list',
    call: (c: CoreClient) => c.market.list(),
    empty: { offered: [], skipped: [] },
  },
  { name: 'logs.send', call: (c: CoreClient) => c.logs.send([ROW]), empty: null },
] as const;

type Case = { name: string; handler: Handler | null; code: CoreCode };

const CASES: Case[] = [
  { name: 'closed port', handler: null, code: 'unreachable' },
  { name: 'no answer for 2 s', handler: silent, code: 'timeout' },
  { name: 'status 500', handler: json(500, { success: false }), code: 'failed' },
  { name: 'a body that is not JSON', handler: text(200, '<html>sign in</html>'), code: 'failed' },
];

// The market reads the body itself, so a body that is not JSON has its own code there.
const codeOf = (service: string, c: Case): CoreCode =>
  c.name === 'a body that is not JSON' && service !== 'logs.send' ? 'not_json' : c.code;

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

const urlFor = async (handler: Handler | null): Promise<string> => {
  if (!handler) return closedPort();
  const stub = await startStub(handler);
  stops.push(stub.close);
  return stub.url;
};

describe.each(SERVICES)('core-client $name: the core does not answer', (service) => {
  it.each(CASES)('$name: the empty answer in less than 2.5 s, no throw', async (c) => {
    const url = await urlFor(c.handler);
    const client = createCoreClient({ url, token: 't', warn: () => undefined });
    const started = Date.now();
    const answer = await service.call(client);
    expect(Date.now() - started).toBeLessThan(BOUND_MS);
    expect(answer.data).toEqual(service.empty);
    expect(answer.down).toMatchObject({ code: codeOf(service.name, c) });
    expect(answer.down?.message).toBe(`${service.name.split('.')[0]} not reachable`);
    expect(client.down()).toEqual(answer.down);
  });

  it.each([
    ['missing', {}],
    ['empty', { AGENTAGE_CORE_URL: '' }],
  ])('a %s AGENTAGE_CORE_URL: down with no core address', async (_name, env) => {
    const client = createCoreClient({ env, token: 't', warn: () => undefined });
    const answer = await service.call(client);
    expect(answer.data).toEqual(service.empty);
    expect(answer.down).toMatchObject({ code: 'no_core', detail: 'no core address' });
  });
});

describe('core-client the address', () => {
  it('reads AGENTAGE_CORE_URL from env', async () => {
    const url = await urlFor(json(404, {}));
    const answer = await createCoreClient({ env: { AGENTAGE_CORE_URL: url } }).market.latest('x');
    expect(answer).toEqual({ data: null, down: null });
  });

  it('keeps what a resolver threw as the cause', async () => {
    const cause = new Error('no discovery');
    const url = () => Promise.reject(cause);
    const answer = await createCoreClient({ url }).market.latest('x');
    expect(answer.down).toMatchObject({ code: 'no_core', cause });
  });

  it('a resolver that never settles stops at the deadline', async () => {
    const url = () => new Promise<string>(() => undefined);
    const answer = await createCoreClient({ url, timeoutMs: 100 }).market.list();
    expect(answer.down).toMatchObject({ code: 'timeout' });
  });

  it('a value that is not a URL is no core address', async () => {
    const answer = await createCoreClient({ url: 'not a url' }).market.latest('x');
    expect(answer.down).toMatchObject({ code: 'no_core' });
  });
});
