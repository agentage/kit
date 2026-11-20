import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { closeNow, createLog, type Log, listen } from '@agentage/extension/internal';
import { cloudApp } from './cloud-app.js';
import { type Drain, drainOf } from './cloud-drain.js';
import { createCloudDiscovery, type DiscoveryOptions } from './cloud-discovery.js';
import { cloudEnvOf, programOf } from './cloud-env.js';
import { readCloudFiles } from './cloud-files.js';
import { createCloudSession } from './cloud-session.js';
import { shellPackageDir } from './shell-package.js';
import { entriesOf, startRuns } from './cloud-run.js';
import { HEARTBEAT_MS, shellEvents } from './shell-events.js';

// Only this cloud entry listens on every interface; the daemon (daemon.ts) binds loopback only.
const EVERY_INTERFACE = '0.0.0.0';

// scheme://user:pass@ becomes scheme://***@ in every log line (the kit masks tokens, not URLs).
export const redactUrls = (text: string): string =>
  text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s:/@"]+:[^\s/@"]+@/gi, '$1***@');

export const cloudLog = (
  version: string,
  write: (line: string) => unknown = (line) => process.stderr.write(line)
): Log =>
  createLog({ extension: 'host', part: 'api', version }, (line) => void write(redactUrls(line)));

// Sign-in off still starts the host; the line says why (the value is never logged).
export const signInOff = (issuer: string | undefined): string =>
  issuer
    ? 'AGENTAGE_ISSUER refused: not an https origin; sign-in is off'
    : 'AGENTAGE_ISSUER not set; sign-in is off';

export interface CloudHost extends Drain {
  port: number;
  stop(): Promise<void>;
  // One read of every upstream document now (the interval reads every 5 s).
  refresh(): Promise<void>;
}

export interface CloudHostOptions {
  log?: Log;
  // The fetch of the auth exchange and sign-out (a test passes a fake auth).
  fetcher?: typeof fetch;
  discovery?: Pick<DiscoveryOptions, 'readMs' | 'everyMs'>;
  drainMs?: number;
  // The shell package folder (a test names one); unset, @agentage/shell-dashboard.
  shellDir?: string;
}

// Env and files checked, the first combine done: a throw here refuses the start.
const partsOf = async (environment: NodeJS.ProcessEnv, o: CloudHostOptions) => {
  const env = cloudEnvOf(environment);
  const log = o.log ?? cloudLog(env.build.version);
  if (env.issuer === null) log.warn(signInOff(environment['AGENTAGE_ISSUER']));
  const shellDir = o.shellDir ?? shellPackageDir();
  const read = await readCloudFiles(env.installationFile, env.upstreamsFile, env.own, shellDir);
  const { files, shell } = read;
  const entries = entriesOf(files);
  // The discovery is made below; the feed reads it only once a page connects.
  const events = shellEvents(HEARTBEAT_MS, () => discovery.current().document);
  const onChange = () => events.send('extensions', { op: 'update' });
  const { installation } = files;
  const discovery = createCloudDiscovery({
    ...o.discovery,
    installation,
    ...(shell && { shell }),
    program: programOf(env),
    entries,
    own: env.own,
    log,
    onChange,
  });
  const runOptions = {
    files,
    installationFile: env.installationFile,
    own: env.own,
    log,
    discovery,
  };
  const { issuer, own, local } = env;
  const fetcher = o.fetcher && { fetcher: o.fetcher };
  const signOut = shell !== undefined;
  const session = createCloudSession({
    issuer,
    own,
    local,
    signOut,
    ...fetcher,
  });
  const host = installation.host;
  return {
    env,
    log,
    events,
    discovery,
    session,
    entries,
    runOptions,
    host,
    shell,
    fetcher: o.fetcher,
  };
};

const stopperOf = (server: Server, stopRuns: () => Promise<void>, stopDiscovery: () => void) => {
  let stopped: Promise<void> | undefined;
  const stop = async () => {
    stopDiscovery();
    await stopRuns();
    await closeNow(server);
  };
  return () => (stopped ??= stop());
};

// The cloud start (J.4.4): check env and files, start the runs, listen on every interface.
export const startCloudHost = async (
  environment: NodeJS.ProcessEnv,
  o: CloudHostOptions = {}
): Promise<CloudHost> => {
  const parts = await partsOf(environment, o);
  const stopRuns = await startRuns(parts.runOptions, parts.entries);
  let stop = stopRuns;
  const { draining, drain } = drainOf(() => stop(), o.drainMs);
  const app = cloudApp({ ...parts, draining });
  const server = await listen(app, parts.env.port, EVERY_INTERFACE).catch(async (err) => {
    await stopRuns();
    throw err;
  });
  const { discovery } = parts;
  // The first read runs beside the start: /health never waits for an upstream.
  void discovery.start();
  stop = stopperOf(server, stopRuns, discovery.stop);
  const port = (server.address() as AddressInfo).port;
  return { port, stop, refresh: discovery.refresh, draining, drain };
};
