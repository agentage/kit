import { inspect } from 'node:util';

// ctx.store.git: run git with { cwd, env } and push to remote; the credential lives in env only.
export interface GitAccess {
  // The store-git remote, with no credential in it (cloud only).
  readonly remote?: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

// The URL of the estate file holds user:password; git gets it as a header, never in a URL or argv.
const splitCredential = (url: string): { remote: string; header?: string } => {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  parsed.username = '';
  parsed.password = '';
  if (!user && !password) return { remote: parsed.href };
  const basic = Buffer.from(`${user}:${password}`).toString('base64');
  return { remote: parsed.href, header: `Authorization: Basic ${basic}` };
};

// No host or user config, no hooks, no ext:: transport, no prompt; only PATH from the parent.
const configOf = (remote?: string, header?: string): [string, string][] => [
  ['core.hooksPath', '/dev/null'],
  ...(remote && header ? [[`http.${remote}.extraHeader`, header] as [string, string]] : []),
];

const gitEnvOf = (root: string, remote?: string, header?: string) => {
  const config = configOf(remote, header);
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'file:http:https',
    GIT_CONFIG_COUNT: String(config.length),
  };
  config.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
};

// A log line or a JSON dump of ctx.store shows no env, so it shows no credential.
export const gitAccessOf = (root: string, url?: string): GitAccess => {
  const { remote, header } = url ? splitCredential(url) : { remote: undefined, header: undefined };
  const shown = { ...(remote && { remote }), cwd: root, env: '[redacted]' };
  return Object.defineProperties(
    { ...(remote && { remote }), cwd: root, env: gitEnvOf(root, remote, header) },
    {
      toJSON: { value: () => shown },
      [inspect.custom]: { value: () => shown },
    }
  );
};
