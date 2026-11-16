import { declaredScopes, partAuth } from '../auth/part-auth.js';
import { scopeOf } from '../auth/token-check.js';
import { SECRETS_DIR } from '../context/secrets.js';
import { parseObject } from '../context/settings.js';
import { readOpenapi } from '../discovery/openapi.js';
import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { portFromEnv, type Env } from '../runtime/build-info.js';
import { GRACE_MS } from '../server/serve.js';
import { CONTAINER_PORT } from '../tool/container-recipe.js';
import { type HostExtras } from './host-extension.js';
import { STORE_OPEN_MS } from './host-store.js';

const LOCAL_VERBS = ['read', 'write'] as const;

export const BIND_REFUSED =
  'AGENTAGE_HOST_BIND=all needs a token check (AGENTAGE_ISSUER, AGENTAGE_AUDIENCE, AGENTAGE_ORIGIN) or AGENTAGE_HOST_AUTH=off';

const TOKEN_ENV = ['AGENTAGE_ISSUER', 'AGENTAGE_AUDIENCE', 'AGENTAGE_ORIGIN'];

// A limit: a positive integer of ms, else the default.
const msOf = (value = '', fallback: number): number =>
  /^[1-9][0-9]*$/.test(value) ? Number(value) : fallback;

// The entry's env with its defaults: port 8080, the current folder, loopback.
export const hostEnvOf = (env: Env) => {
  const port = portFromEnv(env, CONTAINER_PORT);
  return {
    dir: env['AGENTAGE_EXTENSION_DIR'] || process.cwd(),
    port,
    bind: env['AGENTAGE_HOST_BIND'] === 'all' ? '0.0.0.0' : '127.0.0.1',
    dataDir: env['AGENTAGE_DATA_DIR'] ?? '',
    // C2: the daemon's run/{id}; the store lock goes there (a sealed child cannot write beside data/{id}).
    runDir: env['AGENTAGE_RUN_DIR'] ?? '',
    settings: env['AGENTAGE_SETTINGS'] ? parseObject(env['AGENTAGE_SETTINGS']) : {},
    secretsDir: env['AGENTAGE_SECRETS_DIR'] || SECRETS_DIR,
    origin: env['AGENTAGE_ORIGIN'] || `http://127.0.0.1${port ? `:${port}` : ''}`,
    drainMs: msOf(env['AGENTAGE_DRAIN_MS'], GRACE_MS),
    storeOpenMs: msOf(env['AGENTAGE_STORE_OPEN_MS'], STORE_OPEN_MS),
    // G1, G2: the estate's postgres or clickhouse; unset keeps PGlite in dataDir.
    storeUrlFile: env['AGENTAGE_STORE_URL_FILE'] || undefined,
  };
};

// The daemon's signed-in cli user: a loopback request acts as them with read and write; an admin
// route (logs reads, cloud apply, market admin) stays anonymous, as with no user.
const localUser =
  (sub: string): HostExtras['guard'] =>
  async (pkg: ExtensionPackage) => {
    const caller = { sub, scopes: LOCAL_VERBS.map((verb) => scopeOf(pkg.agentage.id, verb)) };
    return { tokenCheck: async (_bearer, access) => (access === 'admin' ? null : caller) };
  };

// Loopback: no token check (the cli user when the daemon names one). Every address: the cloud
// part's check, or an explicit AGENTAGE_HOST_AUTH=off, never with a user.
export const guardOf = (
  env: Env,
  { bind, dir }: { bind: string; dir: string }
): HostExtras['guard'] => {
  const sub = env['AGENTAGE_USER_SUB'];
  if (bind === '127.0.0.1') return sub ? localUser(sub) : undefined;
  if (env['AGENTAGE_HOST_AUTH'] === 'off') return undefined;
  if (TOKEN_ENV.some((key) => !env[key])) throw new Error(BIND_REFUSED);
  return async (pkg: ExtensionPackage, log: Log) => {
    const { id } = pkg.agentage;
    const scopes = declaredScopes(id, await readOpenapi(dir));
    return partAuth(env, id, log, scopes);
  };
};
