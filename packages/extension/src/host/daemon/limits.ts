// Every wait of the daemon has a bound; each is a createDaemon option (docs/part-image.md).
export const LIMITS = {
  // An old child's open requests before it is stopped.
  drainMs: 10_000,
  // A forked child's port report; then SIGKILL.
  startMs: 60_000,
  // A new child's own /health, once it reported its port.
  healthMs: 60_000,
  // A write waits for another process that holds the lock of a daemon file.
  lockMs: 5_000,
  // A request held while its extension swaps children.
  gateMs: 30_000,
  // A child's answer headers; then 504.
  answerMs: 60_000,
  // One Installer call (POST, PATCH, each entry at boot), and a change queued behind others:
  // above the cli's npm bound (10 min), below its client wait (12 min).
  installMs: 660_000,
  // C6: the waits before each restart of a child that exited; the last one repeats.
  backoffMs: [1_000, 2_000, 4_000, 8_000, 16_000],
  // C6: this many exits inside crashWindowMs is failed, with no more restarts.
  crashLimit: 5,
  crashWindowMs: 600_000,
};

export type Limits = typeof LIMITS;

export const limitsOf = (given: Partial<Limits>): Limits => {
  const keys = Object.keys(LIMITS) as (keyof Limits)[];
  return Object.fromEntries(keys.map((key) => [key, given[key] ?? LIMITS[key]])) as Limits;
};
