import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { hostParts, mountedIn } from '../../manifest/parts.js';

export const NEEDS_SECRET = 'NEEDS_SECRET';

// C6: a declared secret of a server part with no value; the daemon checks it before the fork.
export const assertSecrets = (pkg: ExtensionPackage, secrets: Record<string, string>): void => {
  const names = new Set(hostParts(pkg).flatMap((part) => mountedIn(pkg, part)));
  const missing = [...names].find((name) => !secrets[name]);
  if (missing) throw Object.assign(new Error(`needs secret ${missing}`), { code: NEEDS_SECRET });
};

export const needsSecret = (err: unknown): boolean =>
  (err as { code?: unknown } | undefined)?.code === NEEDS_SECRET;

// Healthy before it gets the route: the child's own /health answers 200.
export const healthy = async (port: number, ms: number): Promise<void> => {
  const signal = AbortSignal.timeout(ms);
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal }).catch((err: Error) => {
    if (err.name === 'TimeoutError') throw new Error(`health did not answer in ${ms} ms`);
    const cause = (err.cause as { code?: string } | undefined)?.code ?? err.message;
    throw new Error(`health could not be reached (${cause})`);
  });
  if (res.status !== 200) throw new Error(`health answered ${res.status}`);
};
