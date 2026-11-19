import { setTimeout as sleep } from 'node:timers/promises';
import { fail } from '@agentage/extension/internal';
import { type InstallSpec, type SupervisorDeps } from './supervisor.js';

export const NO_INSTALLER = 'this daemon has no installer: install a folder with { source }';

const BASE = {
  400: 'VALIDATION_ERROR',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  501: 'UNAVAILABLE',
  502: 'UNAVAILABLE',
  504: 'UNAVAILABLE',
} as const;

// The envelope with a status or a code the closed set has not (501, 504, the installer's own code).
export const answer = (
  status: keyof typeof BASE,
  message: string,
  code: string = BASE[status],
  details?: Record<string, unknown>
) =>
  Object.assign(fail(BASE[status], message, { details }), { code, status, retryAfter: undefined });

// An installer error with a string code is the client's envelope; any other stays a 500.
const answerOf = (err: unknown): unknown => {
  const { code, status, message } = (err ?? {}) as Record<string, unknown>;
  if (typeof code !== 'string' || !code) return err;
  const at = status === 404 || status === 502 ? status : 400;
  return answer(at, typeof message === 'string' && message ? message : code, code);
};

// A second call while a timed-out one of that id still runs would overlap it.
const notTwice = (deps: SupervisorDeps, id: string) => {
  const row = deps.pending.timedOut(id);
  if (row) throw answer(409, `the installer of ${id} still runs`, 'CONFLICT', { ...row });
};

// At most installMs, then 504 TIMEOUT; only then the signal asks the installer to stop.
export const runInstaller = async (deps: SupervisorDeps, spec: Omit<InstallSpec, 'signal'>) => {
  if (!deps.install) throw answer(501, NO_INSTALLER);
  notTwice(deps, spec.id);
  const since = new Date().toISOString();
  const stop = new AbortController();
  const timer = new AbortController();
  const call = deps.install({ ...spec, signal: stop.signal });
  const late = sleep(deps.installMs, undefined, { ref: false, signal: timer.signal }).then(() => {
    stop.abort();
    deps.pending.linger(spec.id, since, call);
    throw answer(504, `the installer did not answer in ${deps.installMs} ms`, 'TIMEOUT');
  });
  late.catch(() => undefined);
  const answered = call.catch((err: unknown) => {
    throw answerOf(err);
  });
  return Promise.race([answered, late]).finally(() => timer.abort());
};
