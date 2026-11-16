import type { HostAdapter } from './app.types.js';

export class AppApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AppApiError';
  }
}

// One path under the app's own api: no scheme, no `//`, no `..` (also encoded), no backslash.
export const checkApiPath = (path: string): string => {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new AppApiError('FORBIDDEN', `api path refused: ${path}`, 403);
  }
  const bad =
    !decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    decoded.includes('\\') ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded) ||
    decoded.split(/[/?#]/).some((segment) => segment === '..' || segment === '.');
  if (bad) throw new AppApiError('FORBIDDEN', `api path refused: ${path}`, 403);
  return path;
};

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// A UUIDv7 as 32 lowercase hex, the agcid the kit reads (api-standards section 6).
export const newAgcid = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  return hex(bytes);
};

interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

const readBody = async (res: Response): Promise<Envelope | null> => {
  try {
    return (await res.json()) as Envelope;
  } catch {
    return null;
  }
};

export const callApi = async <T>(
  host: HostAdapter,
  id: string,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  checkApiPath(path);
  const headers = new Headers(init.headers);
  headers.set('X-Agentage-App', id);
  if (!headers.has('agcid')) headers.set('agcid', newAgcid());
  const res = await host.request(id, path, { ...init, headers });
  const body = await readBody(res);
  if (!res.ok || body?.success === false) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    throw new AppApiError(code, body?.error?.message ?? res.statusText, res.status);
  }
  return (body && 'success' in body ? body.data : body) as T;
};
