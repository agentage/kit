import {
  checkApiPath,
  type AppUser,
  type ExtensionInfo,
  type HostAdapter,
  type HostInfo,
} from '@agentage/app';
import type { SessionUser } from './host.types.js';

// K9: on the machine an app holds every verb of its own extension.
export const localScopes = (id: string): string[] => [`${id}:read`, `${id}:write`, `${id}:admin`];

export const appUserOf = (user: SessionUser | null): AppUser | null =>
  user && {
    id: user.id,
    ...(user.email ? { email: user.email } : {}),
    ...(user.name ? { name: user.name } : {}),
  };

// The daemon serves the shell, so the page origin is the host url.
export const localAt = (origin = globalThis.location.origin): HostInfo => ({
  kind: 'local',
  url: origin,
});

// Bound to one app: the caller's id is ignored and the path checked, so no app reaches another.
export const boundRequest =
  (id: string, fetchImpl: typeof fetch): HostAdapter['request'] =>
  async (_appId, path, init) => {
    checkApiPath(path);
    const headers = new Headers(init.headers);
    headers.set('X-Agentage-App', id);
    return fetchImpl(`/api/${id}${path}`, { ...init, headers });
  };

// The local adapter: the daemon proxies `/api/{id}/*` to the child, no token on the machine.
// `at` is the daemon's origin, kind local; the desktop shell passes kind desktop.
export const createLocalHost = (
  { id, version }: ExtensionInfo,
  user: SessionUser | null,
  fetchImpl: typeof fetch,
  at: HostInfo
): HostAdapter => ({
  ...at,
  version,
  user: appUserOf(user),
  scopes: localScopes(id),
  request: boundRequest(id, fetchImpl),
});
