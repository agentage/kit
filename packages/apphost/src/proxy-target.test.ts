import { createServer, request } from 'node:http';
import { request as requestTls } from 'node:https';
import { type AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { errorHandler, startOn, createLog } from '@agentage/extension/internal';
import { type Entries } from './entries.js';
import { addressFor, laneOf, SERVED_BY } from './lane.js';
import { proxyTo, targetOf } from './proxy.js';
import { type Run } from './runner.js';
import { type Entry } from './supervisor.js';

const LIMITS = { gateMs: 1_000, answerMs: 1_000 };

const runAt = (address: string, port = 1): Run => ({
  pid: 0,
  port,
  exited: new Promise(() => undefined),
  address: () => address,
  addresses: () => [address],
  state: () => 'running',
  stop: async () => undefined,
});

describe('targetOf: the transport of an address', () => {
  it.each([
    ['http://127.0.0.1:4100', request, '127.0.0.1', 4100, ''],
    ['http://svc:80', request, 'svc', 80, 'svc'],
    ['https://svc.example', requestTls, 'svc.example', 443, 'svc.example'],
    ['https://svc.example:8443', requestTls, 'svc.example', 8443, 'svc.example'],
    ['https://10.0.0.5', requestTls, '10.0.0.5', 443, ''],
    ['http://[::1]:4100', request, '::1', 4100, ''],
  ])('%s', (address, send, host, port, servername) => {
    expect(targetOf(address)).toEqual({ send, host, port, servername });
  });
});

describe('the proxy sends to the run address, never to a loopback port of its own', () => {
  it('a run whose port is not its address is reached at its address', async () => {
    const server = createServer((req, res) => res.end(`at ${req.url}`));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const entry: Entry = { id: 'u', install: { id: 'u' }, state: 'running', version: '1.0.0' };
    entry.lane = laneOf(runAt(address));
    const app = express().use('/api/:id', proxyTo(new Map([['u', entry]]) as Entries, LIMITS));
    app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
    const daemon = await startOn(app);
    const res = await daemon.fetch('/api/u/echo');
    expect([res.status, await res.text()]).toEqual([200, 'at /api/u/echo']);
    await daemon.close();
    server.close();
  });
});

describe('addressFor', () => {
  it('the routed address of the same lane, else the first address (a swap in between)', () => {
    const lane = laneOf(runAt('http://a:1'));
    const other = laneOf(runAt('http://b:1'));
    expect(addressFor(lane, { [SERVED_BY]: { lane, address: 'http://p:1' } })).toBe('http://p:1');
    expect(addressFor(lane, { [SERVED_BY]: { lane: other, address: 'http://p:1' } })).toBe(
      'http://a:1'
    );
    expect(addressFor(lane, {})).toBe('http://a:1');
  });
});
