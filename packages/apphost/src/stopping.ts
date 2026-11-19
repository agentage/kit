import { fail } from '@agentage/extension/internal';
import { type Child, type Launch } from './child.js';

// Aborted when stop() begins; the starts still in flight, and every child not exited yet.
export interface Stopping {
  signal: AbortSignal;
  launching: Set<Promise<unknown>>;
  children: Set<Child>;
}

export const stoppingOf = (signal: AbortSignal): Stopping => ({
  signal,
  launching: new Set(),
  children: new Set(),
});

export const stopsNow = () => fail('UNAVAILABLE', 'the daemon stops', { retryAfter: 5 });

const started = async (stopping: Stopping, launch: () => Promise<Child>): Promise<Child> => {
  if (stopping.signal.aborted) throw stopsNow();
  const child = await launch();
  stopping.children.add(child);
  void child.exited.then(() => stopping.children.delete(child));
  return child;
};

// No child outlives stop(): none starts once it began; stopAll waits for the ones in flight.
export const launchUnlessStopping =
  (stopping: Stopping, launch: Launch): Launch =>
  (spec) => {
    const run = started(stopping, () => launch(spec));
    stopping.launching.add(run);
    void run.catch(() => undefined).finally(() => stopping.launching.delete(run));
    return run;
  };

// After the drain of each route: a child still starting or swapping is stopped too.
export const stopAll = async (stopping: Stopping): Promise<void> => {
  await Promise.allSettled([...stopping.launching]);
  await Promise.all([...stopping.children].map((child) => child.stop()));
};
