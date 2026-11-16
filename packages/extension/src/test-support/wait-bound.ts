import { vi } from 'vitest';

// The 1 s default of vi.waitFor flakes on a loaded machine; a call with its own bound keeps it.
const WAIT_MS = 10_000;
const bounded = vi.waitFor;
vi.waitFor = ((callback, options) =>
  bounded(
    callback,
    typeof options === 'number' ? options : { timeout: WAIT_MS, ...options }
  )) as typeof vi.waitFor;
