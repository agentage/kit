import { request } from 'node:http';
import { createServer } from 'node:https';
import { type AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { errorHandler, startOn, createLog } from '@agentage/extension/internal';
import { type Entries } from './entries.js';
import { laneOf } from './lane.js';
import { proxyTo } from './proxy.js';
import { type Run } from './runner.js';
import { type Entry } from './supervisor.js';

const LIMITS = { gateMs: 1_000, answerMs: 1_000 };

const runAt = (address: string): Run => ({
  pid: 0,
  port: 1,
  exited: new Promise(() => undefined),
  address: () => address,
  addresses: () => [address],
  state: () => 'running',
  stop: async () => undefined,
});

// An https upstream that records the SNI name of each handshake, then refuses it.
const sniServer = async () => {
  const names: (string | undefined)[] = [];
  const server = createServer({
    SNICallback: (name, done) => (names.push(name), done(new Error('recorded'))),
  });
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { names, port: (server.address() as AddressInfo).port, close: () => server.close() };
};

const sendThrough = async (address: string) => {
  const entry: Entry = { id: 'u', install: { id: 'u' }, state: 'running', version: '1.0.0' };
  entry.lane = laneOf(runAt(address));
  const app = express().use('/api/:id', proxyTo(new Map([['u', entry]]) as Entries, LIMITS));
  app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
  const daemon = await startOn(app);
  // A client Host that is not the upstream: fetch would replace it, so node:http sends it.
  const { hostname, port } = new URL(daemon.url);
  await new Promise<void>((resolve) => {
    const headers = { host: 'platform.next.agentage.io' };
    const sent = request({ hostname, port, path: '/api/u/echo', headers }, (res) => {
      res.resume().on('end', resolve);
    });
    sent.on('error', () => resolve()).end();
  });
  await daemon.close();
};

describe('an https upstream is named by its own address, never by the client Host', () => {
  it('a name upstream: SNI is the upstream name', async () => {
    const upstream = await sniServer();
    await sendThrough(`https://localhost:${upstream.port}`);
    expect(upstream.names).toEqual(['localhost']);
    upstream.close();
  });

  it('an IP upstream: no SNI at all', async () => {
    const upstream = await sniServer();
    await sendThrough(`https://127.0.0.1:${upstream.port}`);
    expect(upstream.names).toEqual([]);
    upstream.close();
  });
});
