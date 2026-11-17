import type { EventSourceLike } from './host.types.js';

const CLOSED = 2;
const FIRST_MS = 1000;
const MAX_MS = 30_000;

// A browser EventSource that got a non-200 answer is CLOSED for good, so open a new one after a back-off.
export const openFeed = (
  events: (url: string) => EventSourceLike,
  url: string,
  wire: (source: EventSourceLike) => void
): (() => void) => {
  let source: EventSourceLike;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = FIRST_MS;
  const connect = () => {
    timer = undefined;
    const current = (source = events(url));
    wire(current);
    current.addEventListener('open', () => (delay = FIRST_MS));
    current.addEventListener('error', () => {
      if (current.readyState !== CLOSED || timer) return;
      current.close();
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, MAX_MS);
    });
  };
  connect();
  return () => {
    clearTimeout(timer);
    source.close();
  };
};
