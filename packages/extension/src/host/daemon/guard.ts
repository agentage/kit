import { type RequestHandler } from 'express';
import { fail } from '../../envelope/envelope.js';

// What a browser says of a request another site started (an <img>, a link, a form).
const FOREIGN = ['cross-site', 'same-site'];

const hostsAt = (port: number): string[] => [`127.0.0.1:${port}`, `localhost:${port}`];

// Only this machine by name (DNS rebinding, a cross-site form): no port given, the socket's own.
// more: other local ports a caller may name, as the daemon's for the request it forwards to a child.
export const localOnly =
  (port?: () => number, more: number[] = []): RequestHandler =>
  (req, _res, next) => {
    const at = port?.() ?? req.socket.localPort ?? 0;
    const hosts = [at, ...more].flatMap(hostsAt);
    const origin = req.get('origin');
    const hostOk = hosts.includes(req.get('host') ?? '');
    const originOk = origin === undefined || hosts.some((host) => origin === `http://${host}`);
    const siteOk = !FOREIGN.includes(req.get('sec-fetch-site') ?? '');
    if (!hostOk || !originOk || !siteOk)
      throw fail('FORBIDDEN', 'Only this machine may call this server');
    next();
  };

// The port of a loopback origin (the daemon's AGENTAGE_ORIGIN); none for any other origin.
export const loopbackPorts = (origin: string | undefined): number[] => {
  try {
    const url = new URL(origin ?? '');
    const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    return local && url.port ? [Number(url.port)] : [];
  } catch {
    return [];
  }
};
