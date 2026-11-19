import { type Express } from 'express';
import { hostParts } from '../../manifest/parts.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { summary, type Entries } from './entries.js';
import { hostDocumentOf, type LastGood } from './host-document.js';
import { restartsOf } from './restart.js';
import { sealOfEntry, type Seal } from './seal.js';
import { type Shell } from './shell-routes.js';
import { type Entry, type SupervisorDeps } from './supervisor.js';

// What /health says of the daemon itself: the values of daemon.json, so a client can prove it.
const DAEMON_SERVICE = 'agentage-daemon';

export interface DaemonInfo {
  version: string;
  pid: number;
  protocol: number;
  // installation.json had rows (or a shape) C3 refuses: they are left out, the file kept as .bad.
  invalid: boolean;
  // installation.json could not be read at boot: every change is refused, the file is never written.
  unreadable?: string;
  // The last change found installation.json not JSON (after boot); the next one that reads it clears it.
  notJson?: boolean;
  // The test clock, set only when it is not 1.
  clockRate?: number;
  // C2: off below the Node floor, with its reason; unset for a launch that does not fork (tests).
  seal?: Seal;
  sealError?: string;
  // S1.2: the shell package the daemon serves at /; unset, the daemon serves no page.
  shell?: Shell;
}

// Read at each call: a reload can change the package in its folder.
const pkgOf = async ({ dir }: Entry) =>
  dir ? readManifest(dir).catch(() => undefined) : undefined;

// PD2: a git store's child is on with a child-process grant: partial; the daemon's status stays ok.
const reported = async (entry: Entry, info: DaemonInfo) => {
  const pkg = await pkgOf(entry);
  const seal = sealOfEntry(info.seal ?? 'off', pkg);
  const parts = pkg ? hostParts(pkg) : [];
  return { ...summary(entry), parts, seal, restarts: restartsOf(entry) };
};

const installationOf = ({ invalid, unreadable, notJson }: DaemonInfo) => {
  if (unreadable) return { installation: 'unreadable', installationError: unreadable };
  return invalid || notJson ? { installation: 'invalid' } : {};
};

const sealMark = ({ seal, sealError }: DaemonInfo) => (seal === 'off' ? { seal, sealError } : {});

const statusOf = (deps: SupervisorDeps, entries: Entries, info: DaemonInfo) => {
  const settled = [...entries.values()].every((e) => ['running', 'disabled'].includes(e.state));
  const clean = !info.invalid && !info.unreadable && !info.notJson && info.seal !== 'off';
  return settled && !deps.unsynced.size && clean ? 'ok' : 'degraded';
};

const healthOf = async (deps: SupervisorDeps, entries: Entries, info: DaemonInfo) => {
  const self = { service: DAEMON_SERVICE, pid: info.pid, protocol: info.protocol };
  const extensions = await Promise.all([...entries.values()].map((e) => reported(e, info)));
  const changing = deps.pending.list();
  const marks = {
    ...(changing.length && { pending: changing }),
    ...(info.clockRate && { clockRate: info.clockRate }),
    ...(deps.unsynced.size && { unsynced: [...deps.unsynced] }),
    ...installationOf(info),
    ...sealMark(info),
  };
  const status = statusOf(deps, entries, info);
  return { status, version: info.version, ...self, extensions, ...marks };
};

const HOST_DISCOVERY_PATH = '/.well-known/agentage-host.json';

export const healthRoutes = (
  app: Express,
  deps: SupervisorDeps,
  entries: Entries,
  info: DaemonInfo
) => {
  const lastGood: LastGood = new Map();
  app.get('/health', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await healthOf(deps, entries, info));
  });
  app.get(HOST_DISCOVERY_PATH, async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await hostDocumentOf(entries, lastGood, info.shell));
  });
};
