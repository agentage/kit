import { checkApiPath, type AppUser, type HostAdapter } from '@agentage/app';
import type { SessionUser } from './host.types.js';

// K9: on the machine an app holds every verb of its own extension.
export const localScopes = (id: string): string[] => [`${id}:read`, `${id}:write`, `${id}:admin`];

export const appUserOf = (user: SessionUser | null): AppUser | null =>
  user && { id: user.id, email: user.email, ...(user.name ? { name: user.name } : {}) };

// The local adapter: the daemon proxies `/api/{id}/*` to the child, no token on the machine.
// Bound to one app: the caller's id is ignored and the path checked, so no app reaches another.
export const createLocalHost = (
  id: string,
  user: SessionUser | null,
  fetchImpl: typeof fetch
): HostAdapter => ({
  user: appUserOf(user),
  scopes: localScopes(id),
  request: async (_appId, path, init) => {
    checkApiPath(path);
    const headers = new Headers(init.headers);
    headers.set('X-Agentage-App', id);
    return fetchImpl(`/api/${id}${path}`, { ...init, headers });
  },
});
