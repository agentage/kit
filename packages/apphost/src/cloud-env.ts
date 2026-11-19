// What the cloud entry reads of its environment; a bad value refuses the start, never a guess.
export interface CloudEnv {
  // new URL(AGENTAGE_URL).origin: the origin of this host's own pages.
  own: string;
  core: string;
  issuer: string | null;
  // LOCAL_FLAG=1: the local run of an app host (apphosts scripts/local.mjs); never in a stack.
  local: boolean;
  port: number;
  installationFile: string;
  upstreamsFile: string;
  build: { version: string; commit: string; buildTime: string };
}

// The stub router's name: apphosts check-stacks already refuses it in every stack.
export const LOCAL_FLAG = 'STUB_LOOPBACK_HTTP';
const MOUNTED = '/run/agentage';
const LOOPBACK = /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)$/;

export const isLoopbackName = (hostname: string): boolean => LOOPBACK.test(hostname);

// The origin of a URL with no path, query, fragment, user or password, in one of the protocols.
const originIn = (value: string | undefined, protocols: string[]): URL | undefined => {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  const bare = !url.username && !url.password && url.origin === value.replace(/\/$/, '');
  return bare && protocols.includes(url.protocol) ? url : undefined;
};

export const httpsOrigin = (value: string | undefined): string | undefined =>
  originIn(value, ['https:'])?.origin;

// An https origin; in a local run also an http one on a loopback name.
const originOf = (env: NodeJS.ProcessEnv, name: string, local: boolean): string => {
  const url = originIn(env[name], local ? ['https:', 'http:'] : ['https:']);
  if (url && (url.protocol === 'https:' || isLoopbackName(url.hostname))) return url.origin;
  throw new Error(`${name}: not an https origin (no path)`);
};

// The stub router's rule: an https AGENTAGE_URL names <host>.<domain> (never https://localhost).
const ownOf = (env: NodeJS.ProcessEnv, local: boolean): string => {
  const own = originOf(env, 'AGENTAGE_URL', local);
  const url = new URL(own);
  if (url.protocol === 'https:' && !/^[a-z0-9-]+\./.test(url.hostname))
    throw new Error('AGENTAGE_URL: not an https://<host>.<domain> origin');
  return own;
};

// The issuer as an https origin; in a local run also http on a loopback or one-label name (the dev
// issuer is the compose service `issuer`), never on a public name. Else no sign-in.
export const issuerOf = (value: string | undefined, local: boolean): string | null => {
  const url = originIn(value, local ? ['https:', 'http:'] : ['https:']);
  if (!url) return null;
  const near = isLoopbackName(url.hostname) || /^[a-z0-9-]+$/.test(url.hostname);
  return url.protocol === 'https:' || near ? url.origin : null;
};

export const portOf = (value = '3000'): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`PORT "${value}": not a port from 0 to 65535`);
  return port;
};

const buildOf = (env: NodeJS.ProcessEnv) => ({
  version: env['VERSION'] ?? '0.0.0',
  commit: env['COMMIT_SHA'] ?? 'unknown',
  buildTime: env['BUILD_TIME'] ?? 'unknown',
});

// The start checks of the cloud entry (J.4.4): AGENTAGE_URL and AGENTAGE_CORE_URL are https origins.
export const cloudEnvOf = (env: NodeJS.ProcessEnv): CloudEnv => {
  const local = env[LOCAL_FLAG] === '1';
  return {
    own: ownOf(env, local),
    core: originOf(env, 'AGENTAGE_CORE_URL', local),
    issuer: issuerOf(env['AGENTAGE_ISSUER'], local),
    local,
    port: portOf(env['PORT']),
    installationFile: env['AGENTAGE_INSTALLATION_FILE'] ?? `${MOUNTED}/installation.json`,
    upstreamsFile: env['AGENTAGE_UPSTREAMS_FILE'] ?? `${MOUNTED}/upstreams.json`,
    build: buildOf(env),
  };
};
