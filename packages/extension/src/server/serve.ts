import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type Express } from 'express';
import { type Log } from '../log/log.js';

export interface ServeOptions {
  app: Express;
  port: number;
  log: Log;
  exit?: (code: number) => void;
  signals?: NodeJS.Signals[];
  // How long a drain may take before the process exits 1.
  graceMs?: number;
}

export const GRACE_MS = 10_000;

export const listen = (app: Express, port: number, host?: string): Promise<Server> =>
  new Promise((resolve, reject) => {
    const done = (err?: Error): void => (err ? reject(err) : resolve(server));
    const server = host === undefined ? app.listen(port, done) : app.listen(port, host, done);
  });

// Open requests are answered; a keep-alive connection is closed once idle, not at its timeout.
const drain = (server: Server, exit: (code: number) => void, graceMs: number): void => {
  const idle = setInterval(() => server.closeIdleConnections(), 100).unref();
  server.close((err) => {
    clearInterval(idle);
    exit(err ? 1 : 0);
  });
  server.closeIdleConnections();
  setTimeout(() => exit(1), graceMs).unref();
};

// SIGTERM drains; a close error or a drain past the grace period exits 1; a second Ctrl-C at once.
export const shutdownOn = (server: Server, options: ServeOptions): (() => void) => {
  const exitWith = options.exit ?? ((code: number) => process.exit(code));
  let [stopping, exited] = [false, false];
  const exit = (code: number): void => {
    if (exited) return;
    exited = true;
    exitWith(code);
  };
  const stop = (signal?: NodeJS.Signals): void => {
    if (stopping && signal === 'SIGINT') exit(130);
    if (stopping) return;
    stopping = true;
    options.log.info('shutting down');
    drain(server, exit, options.graceMs ?? GRACE_MS);
  };
  for (const signal of options.signals ?? ['SIGTERM', 'SIGINT'])
    process.on(signal, () => stop(signal));
  return () => stop();
};

export const serve = async (options: ServeOptions): Promise<Server> => {
  const server = await listen(options.app, options.port);
  shutdownOn(server, options);
  options.log.info('listening', { port: (server.address() as AddressInfo).port });
  return server;
};
