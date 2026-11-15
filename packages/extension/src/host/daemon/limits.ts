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
  // One Installer call (on POST, PATCH and for each entry at boot).
  installMs: 120_000,
};

export type Limits = typeof LIMITS;

export const limitsOf = (given: Partial<Limits>): Limits => {
  const keys = Object.keys(LIMITS) as (keyof Limits)[];
  return Object.fromEntries(keys.map((key) => [key, given[key] ?? LIMITS[key]])) as Limits;
};
