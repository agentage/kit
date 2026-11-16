import { worstOf, type HealthCheck } from '../health/health.js';
import { type HealthStatus } from '../health/health.schema.js';

const statusOf = (check: HealthCheck): Promise<HealthStatus> =>
  check().catch(() => 'unavailable' as const);

// Both checks of one name run; /health shows the worse status.
const bothOf =
  (first: HealthCheck, second: HealthCheck): HealthCheck =>
  async () =>
    worstOf(await Promise.all([statusOf(first), statusOf(second)]));

// One part's view of the host's one map: its own names and the host's stay unique, a name of another part joins.
export const partChecks = (
  shared: Record<string, HealthCheck>,
  reserved: ReadonlySet<string>
): Record<string, HealthCheck> => {
  const own = new Set<string>();
  return new Proxy(shared, {
    has: (_target, name) => own.has(String(name)) || reserved.has(String(name)),
    set: (target, name, check: HealthCheck) => {
      const key = String(name);
      own.add(key);
      const before = target[key];
      target[key] = before ? bothOf(before, check) : check;
      return true;
    },
  });
};
