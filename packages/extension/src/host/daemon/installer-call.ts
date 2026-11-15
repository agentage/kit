import { fail } from '../../envelope/envelope.js';
import { type Installer, type SupervisorDeps } from './supervisor.js';

export const NO_INSTALLER = 'this daemon has no installer: install a folder with { source }';

// 501 as C5 says, in the envelope; the closed code set has no NOT_IMPLEMENTED.
const noInstaller = () =>
  Object.assign(fail('UNAVAILABLE', NO_INSTALLER), { status: 501, retryAfter: undefined });

const BASE = { 400: 'VALIDATION_ERROR', 404: 'NOT_FOUND', 502: 'UNAVAILABLE' } as const;

// An installer error with a string code is the client's envelope; any other stays a 500.
const answerOf = (err: unknown): unknown => {
  const { code, status, message } = (err ?? {}) as Record<string, unknown>;
  if (typeof code !== 'string' || !code) return err;
  const at = status === 404 || status === 502 ? status : 400;
  const failure = fail(BASE[at], typeof message === 'string' && message ? message : code);
  return Object.assign(failure, { code, status: at, retryAfter: undefined });
};

export const runInstaller = async (deps: SupervisorDeps, spec: Parameters<Installer>[0]) => {
  if (!deps.install) throw noInstaller();
  return deps.install(spec).catch((err: unknown) => {
    throw answerOf(err);
  });
};
