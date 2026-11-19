import { type RequestHandler } from 'express';
import { fail } from '@agentage/extension/internal';
import { isLoopbackName } from './cloud-env.js';

const hostnameOf = (host: string) =>
  URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname : '';

// Host allow-listed against AGENTAGE_URL; a local run also takes the local router address.
export const ownHostOnly =
  (own: string, local: boolean): RequestHandler =>
  (req, _res, next) => {
    const host = req.headers.host ?? '';
    if (host === new URL(own).host || (local && isLoopbackName(hostnameOf(host)))) return next();
    throw fail('VALIDATION_ERROR', 'not a name of this host', { code: 'UNKNOWN_HOST' });
  };
