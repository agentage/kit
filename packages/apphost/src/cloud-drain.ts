import { setTimeout as sleep } from 'node:timers/promises';
import { type RequestHandler } from 'express';

// The edge polls Swarm every 3 s: the drain outlasts one poll and ends inside the 10 s stop grace.
export const DRAIN_MS = 5_000;
// The stop grace of the stack: a drain that does not end in it exits 1.
export const GRACE_MS = 10_000;

export interface Drain {
  draining(): boolean;
  // SIGTERM: /health 503 and Connection: close for drainMs, then stop.
  drain(): Promise<void>;
}

export const drainOf = (stop: () => Promise<void>, drainMs = DRAIN_MS): Drain => {
  let draining = false;
  const drain = async () => {
    draining = true;
    await sleep(drainMs);
    await stop();
  };
  return { draining: () => draining, drain };
};

// While draining every answer closes its connection, so the edge moves to another task.
export const closeWhileDraining =
  (draining: () => boolean): RequestHandler =>
  (_req, res, next) => {
    if (draining()) res.setHeader('Connection', 'close');
    next();
  };

// SIGTERM: exit 0 when the drain ends, 1 when the stop grace runs out first.
export const stopOnSignal =
  (host: Pick<Drain, 'drain'>, exit: (code: number) => void, graceMs = GRACE_MS) =>
  () => {
    setTimeout(() => exit(1), graceMs).unref();
    void host.drain().then(() => exit(0));
  };
