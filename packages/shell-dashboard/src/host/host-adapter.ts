import type { ExtensionInfo, HostAdapter } from '@agentage/app';
import { createCloudHost } from './cloud-host.js';
import type { Session } from './host.types.js';
import { createLocalHost, localAt } from './local-host.js';

// One adapter for each kind the program names in /shell/session (J.4.5 row 6).
const ADAPTERS = {
  local: (ext, session, fetchImpl, origin) =>
    createLocalHost(ext, session.user, fetchImpl, localAt(origin)),
  cloud: (ext, session, fetchImpl, origin) => createCloudHost(ext, session.user, fetchImpl, origin),
} satisfies Record<
  string,
  (ext: ExtensionInfo, session: Session, fetchImpl: typeof fetch, origin: string) => HostAdapter
>;

export type AdapterKind = keyof typeof ADAPTERS;

// The kind of the session, or null: a failed read or an unknown kind never falls back to local.
export const adapterKindOf = (session: Session): AdapterKind | null => {
  const kind = session.host?.kind;
  return kind === 'local' || kind === 'cloud' ? kind : null;
};

export const adapterFor = (
  ext: ExtensionInfo,
  session: Session,
  fetchImpl: typeof fetch,
  origin = globalThis.location.origin
): HostAdapter | null => {
  const kind = adapterKindOf(session);
  return kind && ADAPTERS[kind](ext, session, fetchImpl, origin);
};
