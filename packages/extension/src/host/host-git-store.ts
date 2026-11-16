import { constants } from 'node:fs';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasStore } from '../manifest/parts.js';
import { readStoreUrl } from '../store/store-url.js';
import { lockOf, lockWithin } from './host-store.js';
import { type HostStore } from './host-url-store.js';

export interface GitStoreAt {
  dataDir: string;
  runDir?: string;
  openMs: number;
  // AGENTAGE_STORE_URL_FILE: the estate's store-git URL, the remote the part pushes to (PD1).
  file?: string;
}

const NO_QUERY = async (): Promise<never> => {
  throw new Error('a git store has no query: use ctx.store.gitRoot');
};

const writable = (root: string) => async () => {
  await access(root, constants.W_OK);
  return 'ok' as const;
};

const rootOf = async (dataDir: string, log: Log): Promise<string> => {
  if (dataDir) return dataDir;
  log.warn('no data folder: the git store is in a temp folder and lost on exit');
  return mkdtemp(join(tmpdir(), 'agentage-git-'));
};

// G5: a git store is a folder (data/{id}) under the data lock: this process is its single writer.
export const openGitStore = async (
  pkg: ExtensionPackage,
  at: GitStoreAt,
  log: Log
): Promise<HostStore | undefined> => {
  if (!hasStore(pkg, 'git')) return undefined;
  const gitRemote = at.file ? await readStoreUrl(at.file, 'git') : undefined;
  const gitRoot = await rootOf(at.dataDir, log);
  await mkdir(gitRoot, { recursive: true });
  const close = await lockWithin(
    gitRoot,
    at.openMs,
    lockOf({ dataDir: gitRoot, runDir: at.runDir })
  );
  log.info('git store opened', { remote: gitRemote ? 'set' : 'none' });
  const remote = gitRemote ? { gitRemote } : {};
  return { kind: 'git', query: NO_QUERY, gitRoot, ...remote, close, probe: writable(gitRoot) };
};
