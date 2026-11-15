import { request, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { fail } from '../../envelope/envelope.js';
import { enter, type Lane } from './lane.js';
import { type Entries } from './entries.js';
import { type Limits } from './limits.js';

// 404 not installed or disabled (chosen, not to retry); 503 starting, failed, or held past gateMs.
const laneFor = async (entries: Entries, id: string, gateMs: number): Promise<Lane> => {
  const entry = entries.get(id);
  if (!entry) throw fail('NOT_FOUND', `${id} is not installed`);
  if (entry.state === 'disabled') throw fail('NOT_FOUND', `${id} is disabled`);
  if (entry.gate) await Promise.race([entry.gate, sleep(gateMs, undefined, { ref: false })]);
  if (!entry.lane) throw fail('UNAVAILABLE', `${id} is ${entry.state}`, { retryAfter: 5 });
  return entry.lane;
};

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

const answer = (res: Response) => (up: IncomingMessage) => {
  res.writeHead(up.statusCode ?? 502, endToEnd(up.headers));
  up.pipe(res);
};

// Streams the request to the child as it came (path and query kept), no pooled connection.
const forward = (req: Request, res: Response, next: NextFunction, lane: Lane): void => {
  const leave = enter(lane);
  const { method, originalUrl: path } = req;
  const headers = endToEnd(req.headers);
  const options = { host: '127.0.0.1', port: lane.child.port, method, path, headers, agent: false };
  const upstream = request(options, answer(res));
  // A client that went away aborts the request to the child too.
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
    leave();
  });
  upstream.on('error', () => {
    leave();
    if (res.headersSent) return void res.destroy();
    next(fail('UNAVAILABLE', 'The extension did not answer', { retryAfter: 5 }));
  });
  req.pipe(upstream);
};

export const proxyTo =
  (entries: Entries, limits: Pick<Limits, 'gateMs' | 'answerMs'>): RequestHandler =>
  async (req, res, next) => {
    const lane = await laneFor(entries, String(req.params['id']), limits.gateMs);
    forward(req, res, next, lane);
  };
