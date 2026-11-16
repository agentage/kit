import { createLog } from '../log/log.js';
import { CLOCK_RATE_ENV, parseClockRate, setHostClockRate } from '../worker/clock.js';

// Only the kit host child reads the test clock from env; a bad value stops the boot.
export const startHostClock = (env: Record<string, string | undefined>): number => {
  const rate = parseClockRate(env[CLOCK_RATE_ENV]);
  setHostClockRate(rate);
  if (rate !== 1) {
    const log = createLog({ extension: 'host', part: 'api' });
    log.warn('test clock on: job times run faster, for tests only', { clockRate: rate });
  }
  return rate;
};
