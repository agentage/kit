import { setTimeout as sleep } from 'node:timers/promises';
import { type Child } from './child.js';
import { type Route } from './route-of.js';
import { runOf, type Run } from './runner.js';

// The routes of an extension's parts, from its discovery (lane-routes.ts).
export type Served = Route[];

// One running child and the requests open on it, so a swap stops it only once they are answered.
export interface Lane {
  child: Run;
  open: number;
  idle: (() => void)[];
  // What this child serves, from its discovery (lane-routes.ts): one read shared by the
  // requests that wait on it; a failed read is kept until failedUntil.
  routes?: Promise<Served | undefined>;
  failedUntil?: number;
}

// res.locals key: the address that serves the part (lane-routes.ts), kept with its lane.
export const SERVED_BY = 'servedBy';

// The address a request goes to: the one its part was routed to on this lane, else the first.
export const addressFor = (lane: Lane, locals: Record<string, unknown>): string => {
  const by = locals[SERVED_BY] as { lane: Lane; address: string } | undefined;
  return by?.lane === lane ? by.address : lane.child.address();
};

export const laneOf = (child: Child): Lane => ({ child: runOf(child), open: 0, idle: [] });

// Counts one request until leave() is called (once).
export const enter = (lane: Lane): (() => void) => {
  lane.open += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    lane.open -= 1;
    if (lane.open === 0) lane.idle.splice(0).forEach((resolve) => resolve());
  };
};

const drained = (lane: Lane): Promise<void> =>
  lane.open === 0 ? Promise.resolve() : new Promise((resolve) => lane.idle.push(resolve));

// Waits for the open requests (at most drainMs, so a hung one blocks nothing), then stops the child.
export const retire = async (lane: Lane | undefined, drainMs: number): Promise<void> => {
  if (!lane) return;
  await Promise.race([drained(lane), sleep(drainMs, undefined, { ref: false })]);
  await lane.child.stop();
};
