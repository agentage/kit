import {
  request,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from 'node:http';
import { request as requestTls } from 'node:https';
import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { fail } from '@agentage/extension/internal';
import { carriesHostToken } from './host-token.js';
import { addressFor, enter } from './lane.js';
import { portOf } from './runner.js';
import { type Entries } from './entries.js';
import { type Limits } from './limits.js';
import { stopsNow, type Stopping } from './stopping.js';
import { type Entry } from './supervisor.js';

type ProxyLimits = Pick<Limits, 'gateMs' | 'answerMs'> & { stopping?: Stopping };

// With no child: the daemon stops, a change still holds it (state still running), or its state.
const noLane = (entry: Entry, stopping?: Stopping) => {
  if (stopping?.signal.aborted) return stopsNow();
  const now = entry.state === 'running' ? 'changing' : entry.state;
  return fail('UNAVAILABLE', `${entry.id} is ${now}: try again`, { retryAfter: 5 });
};

// 404 not installed or disabled (chosen, not to retry); 503 starting, failed, or held past gateMs.
const laneFor = async (entries: Entries, id: string, limits: ProxyLimits) => {
  const entry = entries.get(id);
  if (!entry) throw fail('NOT_FOUND', `${id} is not installed`);
  if (entry.state === 'disabled') throw fail('NOT_FOUND', `${id} is disabled`);
  if (entry.gate) await Promise.race([entry.gate, sleep(limits.gateMs, undefined, { ref: false })]);
  const lane = entry.lane;
  if (!lane) throw noLane(entry, limits.stopping);
  // Counted in the same tick it is read: a swap cannot stop this child before the request is open.
  return { lane, leave: enter(lane) };
};

type Taken = Awaited<ReturnType<typeof laneFor>>;

const HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

// RFC 9110 7.6.1: hop-by-hop headers, and those the Connection header names, stay on their hop.
export const endToEnd = (headers: IncomingHttpHeaders): IncomingHttpHeaders => {
  const named = String(headers['connection'] ?? '')
    .toLowerCase()
    .split(',');
  const drop = new Set([...HOP, ...named.map((h) => h.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !drop.has(key)));
};

// No answer headers in answerMs: 504 TIMEOUT; the child may still apply the call.
const noAnswer = (ms: number) =>
  Object.assign(fail('UNAVAILABLE', `The extension did not answer in ${ms} ms`), {
    code: 'TIMEOUT',
    status: 504,
    retryAfter: undefined,
  });

// D11: the host token is for the daemon; a child never sees it, also when a client sends it here.
const forChild = (req: Request, hostToken?: string): IncomingHttpHeaders => {
  const headers = endToEnd(req.headers);
  if (hostToken && carriesHostToken(req.headers, hostToken)) delete headers['authorization'];
  return headers;
};

// The transport and target of an address: node:https for an https upstream, else node:http.
export const targetOf = (address: string) => {
  const url = new URL(address);
  const tls = url.protocol === 'https:';
  const port = portOf(address);
  // An IPv6 hostname comes in brackets; the request option takes it bare.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  // TLS names the upstream, never the client's Host header; an IP address sends no SNI.
  return { send: tls ? requestTls : request, host, port, servername: isIP(host) ? '' : host };
};

const requestTo = (req: Request, address: string, hostToken?: string) => {
  const { method, originalUrl: path } = req;
  const { send, host, port, servername } = targetOf(address);
  const headers = forChild(req, hostToken);
  const options = { host, port, servername, method, path, headers, agent: false };
  return send(options);
};

// The child's answer as it streams; an error before its headers is the envelope (504 when late).
const relay = (upstream: ClientRequest, res: Response, next: NextFunction, ms: number) => {
  let late = false;
  const timer = setTimeout(() => ((late = true), upstream.destroy()), ms);
  upstream.on('response', (up: IncomingMessage) => {
    clearTimeout(timer);
    res.writeHead(up.statusCode ?? 502, endToEnd(up.headers));
    // A child gone in the middle of its body: the answer is cut, not left open.
    up.once('close', () => void (up.complete || res.destroy()));
    up.pipe(res);
  });
  upstream.on('error', () => {
    if (res.headersSent) return void res.destroy();
    next(
      late ? noAnswer(ms) : fail('UNAVAILABLE', 'The extension did not answer', { retryAfter: 5 })
    );
  });
  return () => clearTimeout(timer);
};

// Streams the request to the child as it came (path and query kept), no pooled connection.
interface Forward {
  to: Taken;
  ms: number;
  hostToken?: string;
}

const forward = (
  req: Request,
  res: Response,
  next: NextFunction,
  { to, ms, hostToken }: Forward
) => {
  const { lane, leave } = to;
  const upstream = requestTo(req, addressFor(lane, res.locals), hostToken);
  const stop = relay(upstream, res, next, ms);
  upstream.on('error', leave);
  // A client that went away aborts the request to the child too.
  res.on('close', () => {
    stop();
    if (!res.writableFinished) upstream.destroy();
    leave();
  });
  req.pipe(upstream);
};

// ANY /api/{id}/* and /mcp/{id} (C1): the same lane, the same refusals (404 unknown, 503 not running).
export const proxyTo =
  (entries: Entries, limits: ProxyLimits, hostToken?: string): RequestHandler =>
  async (req, res, next) => {
    const to = await laneFor(entries, String(req.params['id']), limits);
    forward(req, res, next, { to, ms: limits.answerMs, hostToken });
  };
