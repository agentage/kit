import type { EventSourceLike } from './host.types.js';

const CLOSED = 2;
const FIRST_MS = 1000;
const MAX_MS = 30_000;

// A browser EventSource that got a non-200 answer is CLOSED for good, so open a new one after a back-off.
export const openFeed = (
  events: (url: string) => EventSourceLike,
  url: string,
  wire: (source: EventSourceLike) => void,
  random: () => number = Math.random
): (() => void) => {
  let source: EventSourceLike;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let span = 2 * FIRST_MS;
  // Full jitter above a 1 s floor: the pages one deploy cut off do not all come back at once.
  const waitMs = () => FIRST_MS + Math.floor(random() * (span - FIRST_MS));
  const connect = () => {
    timer = undefined;
    const current = (source = events(url));
    wire(current);
    current.addEventListener('open', () => (span = 2 * FIRST_MS));
    current.addEventListener('error', () => {
      if (current.readyState !== CLOSED || timer) return;
      current.close();
      timer = setTimeout(connect, waitMs());
      span = Math.min(span * 2, MAX_MS);
    });
  };
  connect();
  return () => {
    clearTimeout(timer);
    source.close();
  };
};
