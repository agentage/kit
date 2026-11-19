import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createLog, startOn, type TestServer } from '@agentage/extension/internal';
import { endToEnd, pipeTo } from './proxy.js';
import { signInOff } from './cloud-host.js';
import { closeUpstreams, cloudEnv, startCloud, type Started } from './test-support/cloud-start.js';

const open: (Server | TestServer)[] = [];
let host: Started | undefined;
afterEach(async () => {
  for (const s of open.splice(0))
    'url' in s ? await s.close() : (s.closeAllConnections(), s.close());
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

// An upstream that sends its answer headers after `ms`.
const slow = async (ms: number) => {
  const server = createServer((_req, res) => void setTimeout(() => res.end('late'), ms));
  open.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

// The one forward alone; `failed` answers 599 and says if it was late.
const serve = async (address: string, answerMs?: number) => {
  const app = express();
  app.use((req, res) => {
    const failed = (late: boolean) => void res.status(599).end(late ? 'late' : 'error');
    const answerHeaders = (up: { headers: object }) => endToEnd(up.headers as never);
    pipeTo(req, res, {
      address,
      path: req.originalUrl,
      headers: {},
      answerMs,
      answerHeaders,
      failed,
    });
  });
  const server = await startOn(app);
  open.push(server);
  return server;
};

describe('pipeTo: the one forward of both hosts', () => {
  it('with no answerMs (the cloud host) a slow upstream is waited for', async () => {
    const res = await (await serve(await slow(300))).fetch('/x');
    expect([res.status, await res.text()]).toEqual([200, 'late']);
  });

  it('with answerMs (the daemon) a slow upstream is a late failure', async () => {
    const res = await (await serve(await slow(300), 50)).fetch('/x');
    expect([res.status, await res.text()]).toEqual([599, 'late']);
  });

  it('an upstream that refuses the connection is a failure that is not late', async () => {
    const res = await (await serve('http://127.0.0.1:1', 1_000)).fetch('/x');
    expect([res.status, await res.text()]).toEqual([599, 'error']);
  });
});

describe('the cloud start says when sign-in is off', () => {
  const linesOf = async (extra: Record<string, string>) => {
    const lines: string[] = [];
    const log = createLog({ extension: 'host', part: 'api' }, (line) => void lines.push(line));
    host = await startCloud(await cloudEnv({ extensions: [], upstreams: [] }, extra), { log });
    return lines.filter((l) => l.includes('sign-in is off'));
  };

  it.each([
    [{ AGENTAGE_ISSUER: 'http://auth.example' }, signInOff('x')],
    [{}, signInOff(undefined)],
  ])('%o: one warning line, no value in it', async (extra, text) => {
    const lines = await linesOf(extra);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(text);
    expect(lines[0]).not.toContain('auth.example');
    expect(JSON.parse(lines[0] as string)).toMatchObject({ level: 'warn' });
  });

  it('an https issuer: no warning', async () => {
    expect(await linesOf({ AGENTAGE_ISSUER: 'https://auth.next.agentage.io' })).toEqual([]);
  });
});
