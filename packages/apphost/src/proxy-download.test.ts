import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  download,
  startOn,
  startTestServer,
  type ApiContext,
  type TestServer,
} from '@agentage/extension/internal';
import { laneOf } from './lane.js';
import { proxyTo } from './proxy.js';
import { type Entry } from './supervisor.js';

const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 255]);
const zip = { summary: 'Export', produces: 'application/zip' };
const create = ({ route }: ApiContext) => {
  route('get', '/export', zip, () => download(ZIP, { filename: 'memories.zip' }));
};

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('a file through the daemon proxy', () => {
  it('keeps the bytes, the content type and the attachment name', async () => {
    server = await startTestServer({ create });
    const child = { port: Number(new URL(server.url).port), pid: 1, stop: async () => undefined };
    const entry: Entry = { id: 'test', install: { id: 'test' }, state: 'running', version: '1' };
    entry.lane = laneOf({ ...child, exited: new Promise<never>(() => undefined) });
    const proxy = proxyTo(new Map([['test', entry]]), { gateMs: 1_000, answerMs: 5_000 });
    const daemon = await startOn(express().use('/api/:id', proxy));
    const res = await daemon.fetch('/api/test/export');
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename=memories.zip');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ZIP);
    await daemon.close();
  });
});
