import { fail } from '@agentage/extension/internal';
// One change at a time, the boot included: two installs never race on installation.json or one extension.
export type Queue = <T>(fn: () => Promise<T>) => Promise<T>;

export const serialQueue = (): Queue => {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
};

// A change that waited ms for the ones before it (the boot too) is 503 and never runs.
export const waitAtMost = <T>(queue: Queue, ms: number, fn: () => Promise<T>): Promise<T> => {
  let gaveUp = false;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      gaveUp = true;
      reject(fail('UNAVAILABLE', `other changes ran for ${ms} ms: try again`, { retryAfter: 5 }));
    }, ms);
  });
  const run = queue(async () => {
    clearTimeout(timer);
    if (gaveUp) return undefined as T;
    return fn();
  });
  return Promise.race([run, late]);
};
