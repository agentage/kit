import { type RequestHandler } from 'express';
import { fail } from '../../envelope/envelope.js';

// What a browser says of a request another site started (an <img>, a link, a form).
const FOREIGN = ['cross-site', 'same-site'];

// Only this machine, by name: a page elsewhere (DNS rebinding, a cross-site form or GET) gets 403.
export const localOnly =
  (port: () => number): RequestHandler =>
  (req, _res, next) => {
    const hosts = [`127.0.0.1:${port()}`, `localhost:${port()}`];
    const origin = req.get('origin');
    const hostOk = hosts.includes(req.get('host') ?? '');
    const originOk = origin === undefined || hosts.some((host) => origin === `http://${host}`);
    const siteOk = !FOREIGN.includes(req.get('sec-fetch-site') ?? '');
    if (!hostOk || !originOk || !siteOk)
      throw fail('FORBIDDEN', 'Only this machine may call the daemon');
    next();
  };
