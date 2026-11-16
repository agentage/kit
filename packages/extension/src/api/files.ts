import { type Express, type Request, type RequestHandler } from 'express';
import { setCaller, type Access, type Caller, type TokenCheck } from '../auth/token-check.js';
import { fail, isFailure } from '../envelope/envelope.js';
import { type FilesEntry, type FilesOptions } from './files-registry.js';

export const filesPathOf = (id: string): string => `/files/${id}`;

const UPLOAD = 'git-upload-pack';

// The raw query is exactly one service=git-upload-pack: no second or encoded key, no other text.
const onlyUploadService = (req: Request): boolean => {
  const at = req.originalUrl.indexOf('?');
  return at >= 0 && req.originalUrl.slice(at + 1) === `service=${UPLOAD}`;
};

// Default deny: only a clone or fetch reads; anything else (a push, any odd form) needs write.
export const filesAccess = (req: Request): Access => {
  if (req.method === 'GET' && req.path.endsWith('/info/refs') && onlyUploadService(req))
    return 'read';
  if (req.method === 'POST' && req.path.endsWith(`/${UPLOAD}`) && !req.originalUrl.includes('?'))
    return 'read';
  return 'write';
};

const decoded = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '..';
  }
};

// A dot segment, raw or encoded (also one hidden behind an encoded slash), never reaches the handler.
export const hasDotSegment = (path: string): boolean =>
  path
    .split('/')
    .flatMap((segment) => decoded(segment).split(/[/\\]/))
    .some((segment) => segment === '..' || segment === '.');

// git sends the token as the Basic password; a Bearer header passes as it is.
export const bearerOf = (authorization: string | undefined): string | undefined => {
  const [scheme = '', credential = ''] = (authorization ?? '').split(' ');
  if (scheme.toLowerCase() !== 'basic') return authorization;
  const decodedBasic = Buffer.from(credential, 'base64').toString('utf8');
  return `Bearer ${decodedBasic.slice(decodedBasic.indexOf(':') + 1)}`;
};

// git asks for credentials only after a 401 that names Basic.
const BASIC = { 'WWW-Authenticate': 'Basic realm="agentage"' };

const callerFor = async (req: Request, access: Access, check?: TokenCheck) => {
  if (!check) return null;
  return check(bearerOf(req.get('authorization')), access).catch((err: unknown) => {
    if (isFailure(err) && err.status === 401)
      throw fail('UNAUTHORIZED', err.message, { headers: BASIC });
    throw err;
  });
};

const tooLarge = () => fail('PAYLOAD_TOO_LARGE', 'The push is too large');

// Counts the bytes as the socket delivers them, so a chunked push stops at the cap too.
const capBody = (req: Request, max: number): void => {
  if (Number(req.get('content-length') ?? 0) > max) throw tooLarge();
  let bytes = 0;
  const push = req.push.bind(req);
  req.push = (chunk: unknown, encoding?: BufferEncoding) => {
    bytes += chunk ? (chunk as Buffer).length : 0;
    if (bytes <= max) return push(chunk, encoding);
    req.destroy(tooLarge());
    return false;
  };
};

const filesGuard =
  (options: FilesOptions, check?: TokenCheck): RequestHandler =>
  async (req, res, next) => {
    if (hasDotSegment(req.path))
      throw fail('VALIDATION_ERROR', 'A path may not hold a dot segment');
    const access = filesAccess(req);
    const caller: Caller | null = await callerFor(req, access, check);
    if (caller) res.setHeader('Cache-Control', 'no-store');
    setCaller(req, caller);
    if (options.owner && !(await options.owner(req as never, caller)))
      throw fail('FORBIDDEN', 'Not the owner of this path');
    if (access === 'write' && options.maxPushBytes !== undefined)
      capBody(req, options.maxPushBytes);
    next();
  };

// No token check (a daemon child): anonymous, but the dot, owner and size checks still run.
export const mountFiles = (app: Express, id: string, entry: FilesEntry, check?: TokenCheck) =>
  void app.use(filesPathOf(id), filesGuard(entry.options, check), entry.handler as RequestHandler);
