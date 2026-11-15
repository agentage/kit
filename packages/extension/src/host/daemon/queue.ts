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
