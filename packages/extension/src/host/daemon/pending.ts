export type PendingOp = 'install' | 'update' | 'remove';

export interface Pending {
  op: PendingOp;
  id?: string;
  source?: string;
  since: string;
}

// The changes taken and not yet answered, queued ones too: /health shows one the client gave up on.
export const pendingChanges = () => {
  const open = new Set<Pending>();
  const track = async <T>(change: Omit<Pending, 'since'>, fn: () => Promise<T>): Promise<T> => {
    const row = { ...change, since: new Date().toISOString() };
    open.add(row);
    try {
      return await fn();
    } finally {
      open.delete(row);
    }
  };
  return { track, list: () => [...open] };
};

export type PendingChanges = ReturnType<typeof pendingChanges>;
