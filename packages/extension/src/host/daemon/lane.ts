import { type Child } from './child.js';

// One running child and the requests open on it, so a swap stops it only once they are answered.
export interface Lane {
  child: Child;
  version: string;
  open: number;
  idle: (() => void)[];
}

export const laneOf = (child: Child, version: string): Lane => ({
  child,
  version,
  open: 0,
  idle: [],
});

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

export const drained = (lane: Lane): Promise<void> =>
  lane.open === 0 ? Promise.resolve() : new Promise((resolve) => lane.idle.push(resolve));

const waited = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

// Waits for the open requests (at most drainMs, so a hung one blocks nothing), then stops the child.
export const retire = async (lane: Lane | undefined, drainMs: number): Promise<void> => {
  if (!lane) return;
  await Promise.race([drained(lane), waited(drainMs)]);
  await lane.child.stop();
};
