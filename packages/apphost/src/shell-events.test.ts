import { type Request, type Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { shellEvents, STALLED_WRITES } from './shell-events.js';

const client = (accepts: boolean) => {
  const res = { writeHead: vi.fn(), write: vi.fn(() => accepts), destroy: vi.fn() };
  const req = { on: vi.fn() };
  return { res, req };
};

describe('the shell event stream (K7)', () => {
  it('drops a tab that refuses writes many times in a row; a reading tab stays', () => {
    const events = shellEvents(60_000);
    const stalled = client(false);
    const reading = client(true);
    for (const c of [stalled, reading])
      events.stream(c.req as unknown as Request, c.res as unknown as Response, vi.fn());
    for (let i = 0; i < STALLED_WRITES + 2; i += 1) events.send('extensions', { op: 'x' });
    expect(stalled.res.destroy).toHaveBeenCalledTimes(1);
    expect(stalled.res.write).toHaveBeenCalledTimes(1 + STALLED_WRITES);
    expect(reading.res.destroy).not.toHaveBeenCalled();
    expect(reading.res.write).toHaveBeenCalledTimes(1 + STALLED_WRITES + 2);
  });
});
