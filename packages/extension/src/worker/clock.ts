export const CLOCK_RATE_ENV = 'AGENTAGE_CLOCK_RATE';
export const MAX_CLOCK_RATE = 3600;

// The test clock: a rate of 60 makes one cron minute last one second; a bad value is refused, never ignored.
export const parseClockRate = (raw: string | number | undefined): number => {
  if (raw === undefined || raw === '') return 1;
  const rate = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(rate) || rate < 1 || rate > MAX_CLOCK_RATE) {
    throw new Error(`${CLOCK_RATE_ENV} must be a number from 1 to ${MAX_CLOCK_RATE}, got "${raw}"`);
  }
  return rate;
};

// Read once at boot; the clock starts at the real time and runs `rate` times faster.
export const scaledNow = (rate: number): (() => Date) => {
  const start = Date.now();
  return () => new Date(start + (Date.now() - start) * rate);
};
