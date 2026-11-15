import { setTimeout as sleep } from 'node:timers/promises';
import { fail } from '../../envelope/envelope.js';
import { type InstallSpec, type SupervisorDeps } from './supervisor.js';

export const NO_INSTALLER = 'this daemon has no installer: install a folder with { source }';

const BASE = {
  400: 'VALIDATION_ERROR',
  404: 'NOT_FOUND',
  501: 'UNAVAILABLE',
  502: 'UNAVAILABLE',
  504: 'UNAVAILABLE',
} as const;

// The envelope with a status or a code the closed set has not (501, 504, the installer's own code).
const answer = (status: keyof typeof BASE, message: string, code: string = BASE[status]) =>
  Object.assign(fail(BASE[status], message), { code, status, retryAfter: undefined });

// An installer error with a string code is the client's envelope; any other stays a 500.
const answerOf = (err: unknown): unknown => {
  const { code, status, message } = (err ?? {}) as Record<string, unknown>;
  if (typeof code !== 'string' || !code) return err;
  const at = status === 404 || status === 502 ? status : 400;
  return answer(at, typeof message === 'string' && message ? message : code, code);
};

// At most installMs, then 504; only then the signal asks an installer that honours it to stop.
export const runInstaller = async (deps: SupervisorDeps, spec: Omit<InstallSpec, 'signal'>) => {
  if (!deps.install) throw answer(501, NO_INSTALLER);
  const stop = new AbortController();
  const timer = new AbortController();
  const late = sleep(deps.installMs, undefined, { ref: false, signal: timer.signal }).then(() => {
    stop.abort();
    throw answer(504, `the installer did not answer in ${deps.installMs} ms`);
  });
  late.catch(() => undefined);
  const call = deps.install({ ...spec, signal: stop.signal }).catch((err: unknown) => {
    throw answerOf(err);
  });
  return Promise.race([call, late]).finally(() => timer.abort());
};
