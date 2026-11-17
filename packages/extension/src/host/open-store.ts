import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { openGitStore, type GitStoreAt } from './host-git-store.js';
import { openUrlStore, type HostStore, type UrlStoreAt } from './host-url-store.js';

export type OpenStoreAt = GitStoreAt & UrlStoreAt;

// The one opener of the daemon, the one container and the part image: git, else a store URL file.
export const openStore = async (
  pkg: ExtensionPackage,
  at: OpenStoreAt,
  log: Log
): Promise<HostStore | undefined> =>
  (await openGitStore(pkg, at, log)) ?? (await openUrlStore(pkg, at, log));
