import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { closeNow, createLog, type Log, listen } from '@agentage/extension/internal';
import { cloudApp } from './cloud-app.js';
import { createCloudDiscovery, type DiscoveryOptions } from './cloud-discovery.js';
import { cloudEnvOf } from './cloud-env.js';
import { readCloudFiles } from './cloud-files.js';
import { createCloudSession } from './cloud-session.js';
import { entriesOf, startRuns } from './cloud-run.js';
import { shellEvents } from './shell-events.js';

// Only this cloud entry listens on every interface; the daemon (daemon.ts) binds loopback only.
const EVERY_INTERFACE = '0.0.0.0';

export const cloudLog = (version: string): Log =>
  createLog({ extension: 'host', part: 'api', version });

export interface CloudHost {
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
}

// Env and files checked, the first combine done: a throw here refuses the start.
const partsOf = async (environment: NodeJS.ProcessEnv, o: CloudHostOptions) => {
  const env = cloudEnvOf(environment);
  const log = o.log ?? cloudLog(env.build.version);
  const files = await readCloudFiles(env.installationFile, env.upstreamsFile, env.own);
  const entries = entriesOf(files);
  const events = shellEvents();
  const onChange = () => events.send('extensions', { op: 'update' });
  const { installation } = files;
  const discovery = createCloudDiscovery({
    ...o.discovery,
    installation,
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
  // The host id of /shell/session is the installation's (decision 2026-11-19: today's behaviour).
  const session = createCloudSession({ issuer, own, local, host: installation.host, ...fetcher });
  return { env, log, events, discovery, session, entries, runOptions, host: installation.host };
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
  const server = await listen(cloudApp(parts), parts.env.port, EVERY_INTERFACE).catch(
    async (err) => {
      await stopRuns();
      throw err;
    }
  );
  const { discovery } = parts;
  // The first read runs beside the start: /health never waits for an upstream.
  void discovery.start();
  const stop = stopperOf(server, stopRuns, discovery.stop);
  return { port: (server.address() as AddressInfo).port, stop, refresh: discovery.refresh };
};
