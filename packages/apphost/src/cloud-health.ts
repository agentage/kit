import { randomBytes } from 'node:crypto';
import { type RequestHandler } from 'express';
import { fail, ok } from '@agentage/extension/internal';
import { type CloudEnv } from './cloud-env.js';

// The part a cloud host reports on /health, as the stub router did (estate verify reads .part).
export const ROUTER_PART = 'router';

// Process health only, read by the image check on 127.0.0.1 (the edge does not route /health).
export const cloudHealth = (
  host: string,
  { build }: Pick<CloudEnv, 'build'>,
  draining: () => boolean,
  ready: () => boolean
): RequestHandler => {
  const instance = randomBytes(4).toString('hex');
  const started = Date.now();
  return (_req, res) => {
    if (draining()) throw fail('UNAVAILABLE', 'draining before stop', { retryAfter: 1 });
    if (!ready()) throw fail('UNAVAILABLE', 'first discovery pass not done', { retryAfter: 1 });
    const uptimeSeconds = Math.floor((Date.now() - started) / 1000);
    const checkedAt = new Date().toISOString();
    const data = { status: 'ok', extension: host, part: ROUTER_PART, ...build, instance };
    res.set('Cache-Control', 'no-store');
    res.json(ok({ ...data, uptimeSeconds, checkedAt, checks: {} }));
  };
};
