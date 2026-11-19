import type { Session } from './host.types.js';

// A cloud host sends no `session` event, so a failed read is tried again before the shell gives up.
export const SESSION_RETRY_MS = [300, 1000];

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// Up to three reads; null only when all three failed.
export const readSession = async (
  read: () => Promise<Session | null>,
  wait: (ms: number) => Promise<void> = sleep
): Promise<Session | null> => {
  for (const ms of SESSION_RETRY_MS) {
    const session = await read();
    if (session) return session;
    await wait(ms);
  }
  return read();
};
