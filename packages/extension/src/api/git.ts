import { type Express, type Request, type RequestHandler } from 'express';
import { setCaller, type Access, type TokenCheck } from '../auth/token-check.js';
import { fail, isFailure } from '../envelope/envelope.js';
import { type GitHandler } from './git-registry.js';

export const gitPathOf = (id: string): string => `/git/${id}`;

// A push (receive-pack, its info/refs too) writes; a clone or fetch reads.
export const gitAccess = (req: Request): Access =>
  req.path.endsWith('/git-receive-pack') || req.query['service'] === 'git-receive-pack'
    ? 'write'
    : 'read';

// git sends the token as the Basic password; a Bearer header passes as it is.
export const bearerOf = (authorization: string | undefined): string | undefined => {
  const [scheme = '', credential = ''] = (authorization ?? '').split(' ');
  if (scheme.toLowerCase() !== 'basic') return authorization;
  const decoded = Buffer.from(credential, 'base64').toString('utf8');
  return `Bearer ${decoded.slice(decoded.indexOf(':') + 1)}`;
};

// git asks for credentials only after a 401 that names Basic.
const BASIC = { 'WWW-Authenticate': 'Basic realm="agentage"' };

const gitGuard =
  (tokenCheck: TokenCheck): RequestHandler =>
  async (req, res, next) => {
    const caller = await tokenCheck(bearerOf(req.get('authorization')), gitAccess(req)).catch(
      (err: unknown) => {
        if (isFailure(err) && err.status === 401)
          throw fail('UNAUTHORIZED', err.message, { headers: BASIC });
        throw err;
      }
    );
    if (caller) res.setHeader('Cache-Control', 'no-store');
    setCaller(req, caller);
    next();
  };

// No token check (a daemon child): anonymous, as every other route there.
export const mountGit = (app: Express, id: string, handler: GitHandler, check?: TokenCheck) =>
  void app.use(gitPathOf(id), ...(check ? [gitGuard(check)] : []), handler as RequestHandler);
