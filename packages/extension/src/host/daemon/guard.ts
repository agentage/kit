import { type RequestHandler } from 'express';
import { fail } from '../../envelope/envelope.js';

// Only this machine, by name: a page elsewhere (DNS rebinding, a cross-site form) gets 403.
export const localOnly =
  (port: () => number): RequestHandler =>
  (req, _res, next) => {
    const hosts = [`127.0.0.1:${port()}`, `localhost:${port()}`];
    const origin = req.get('origin');
    const hostOk = hosts.includes(req.get('host') ?? '');
    const originOk = origin === undefined || hosts.some((host) => origin === `http://${host}`);
    if (!hostOk || !originOk) throw fail('FORBIDDEN', 'Only this machine may call the daemon');
    next();
  };
