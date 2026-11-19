import { type ExtensionPackage, hostParts, mountedIn } from '@agentage/extension/internal';

const NEEDS_SECRET = 'NEEDS_SECRET';

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

// Each value raw and as it shows inside a JSON log row (quotes, backslashes escaped).
export const maskedForms = (secrets: Record<string, string>): string[] =>
  [...new Set(Object.values(secrets).flatMap((v) => [v, JSON.stringify(v).slice(1, -1)]))]
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);

// A secret value this child was given never reaches error, /health, the list or the log.
export const redact = (text: string, secrets: Record<string, string>): string =>
  maskedForms(secrets).reduce((out, value) => out.split(value).join('***'), text);
