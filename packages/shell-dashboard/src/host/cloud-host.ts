import type { ExtensionInfo, HostAdapter } from '@agentage/app';
import type { SessionUser } from './host.types.js';
import { appUserOf, boundRequest } from './local-host.js';

// The cloud adapter: the program swaps the session cookie for a token on each `/api/{id}/*` call.
// No scope hint: the page holds no token and the session names none, so the api decides.
export const createCloudHost = (
  { id, version }: ExtensionInfo,
  user: SessionUser | null,
  fetchImpl: typeof fetch,
  url: string
): HostAdapter => ({
  kind: 'cloud',
  url,
  version,
  user: appUserOf(user),
  scopes: [],
  request: boundRequest(id, fetchImpl),
});
