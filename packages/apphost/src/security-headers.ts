import helmet from 'helmet';
import { type RequestHandler } from 'express';

// The edge's values (estate gateway-headers), so a header the edge also sets never has two values.
// No CSP header: the shell page carries its own in a meta tag, and a proxied answer keeps the upstream's.
export const hostHeaders = (https: boolean): RequestHandler =>
  helmet({
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: https ? { maxAge: 31536000, includeSubDomains: false } : false,
  });
