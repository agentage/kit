import { retire } from './lane.js';
import { cancelRestart } from './restart.js';
import { type Entry } from './supervisor.js';

// New requests of the extension wait here (the proxy gives up after gateMs) until release.
export const hold = (entry: Entry): (() => void) => {
  let release = () => undefined as void;
  entry.gate = new Promise<void>((resolve) => (release = resolve));
  return () => {
    entry.gate = undefined;
    release();
  };
};

// Detached first, so its exit is not a failure; then drained and stopped.
export const halt = async (entry: Entry, drainMs: number): Promise<void> => {
  cancelRestart(entry);
  const lane = entry.lane;
  entry.lane = undefined;
  await retire(lane, drainMs);
};
