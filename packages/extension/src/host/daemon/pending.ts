export type PendingOp = 'install' | 'update' | 'remove';

export interface Pending {
  op: PendingOp;
  id?: string;
  source?: string;
  since: string;
  // The daemon stopped waiting (installMs) but the installer still runs.
  timedOut?: true;
}

// The changes taken and not yet answered, queued ones too: /health shows one the client gave up on.
export const pendingChanges = () => {
  const open = new Set<Pending>();
  const until = async <T>(row: Pending, work: Promise<T>): Promise<T> => {
    open.add(row);
    try {
      return await work;
    } finally {
      open.delete(row);
    }
  };
  const track = <T>(change: Omit<Pending, 'since'>, fn: () => Promise<T>): Promise<T> =>
    until({ ...change, since: new Date().toISOString() }, Promise.resolve().then(fn));
  // A timed-out installer call stays listed until it settles.
  const linger = (id: string, since: string, work: Promise<unknown>): void =>
    void until({ op: 'install', id, since, timedOut: true }, work).catch(() => undefined);
  const timedOut = (id: string) => [...open].find((row) => row.timedOut && row.id === id);
  return { track, linger, timedOut, list: () => [...open] };
};

export type PendingChanges = ReturnType<typeof pendingChanges>;
