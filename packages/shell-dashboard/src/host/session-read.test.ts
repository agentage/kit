import { describe, expect, it, vi } from 'vitest';
import type { Session } from './host.types.js';
import { readSession, SESSION_RETRY_MS } from './session-read.js';

const GOOD: Session = { user: null, host: { kind: 'cloud' } };

describe('readSession: three tries before a failure', () => {
  it('a first good read returns at once, no wait', async () => {
    const wait = vi.fn(async (_ms: number) => undefined);
    await expect(readSession(async () => GOOD, wait)).resolves.toBe(GOOD);
    expect(wait).not.toHaveBeenCalled();
  });

  it('two failed reads (a 503 twice) then a good one: the good session, after the backoff', async () => {
    const answers = [null, null, GOOD];
    const wait = vi.fn(async (_ms: number) => undefined);
    await expect(readSession(async () => answers.shift() ?? null, wait)).resolves.toBe(GOOD);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual(SESSION_RETRY_MS);
  });

  it('three failed reads: null, and no fourth read', async () => {
    const read = vi.fn(async () => null);
    await expect(readSession(read, async () => undefined)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
  });
});
