export const CLOCK_RATE_ENV = 'AGENTAGE_CLOCK_RATE';
export const MAX_CLOCK_RATE = 3600;

// The test clock (tests only): it scales run timestamps, job ms, timeoutMs and the late check. A rate of 60 makes one cron minute last one second; a bad value is refused, never ignored.
export const parseClockRate = (raw: string | number | undefined): number => {
  if (raw === undefined || raw === '') return 1;
  const rate = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(rate) || rate < 1 || rate > MAX_CLOCK_RATE) {
    throw new Error(`${CLOCK_RATE_ENV} must be a number from 1 to ${MAX_CLOCK_RATE}, got "${raw}"`);
  }
  return rate;
};

// Set once by the kit host child; the cloud part runner never sets it, so it stays 1 there.
let hostRate = 1;
export const setHostClockRate = (rate: number): void => void (hostRate = rate);
export const hostClockRate = (): number => hostRate;

// Read once at boot; the clock starts at the real time and runs `rate` times faster.
export const scaledNow = (rate: number): (() => Date) => {
  const start = Date.now();
  return () => new Date(start + (Date.now() - start) * rate);
};
