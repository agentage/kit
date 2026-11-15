import { join } from 'node:path';
import { fail } from '../../envelope/envelope.js';
import { readJsonFile } from './json-file.js';

const alive = (pid: number): boolean => {
  try {
    return process.kill(pid, 0);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// A daemon.json of a dead or other process is stale: only one that answers as that daemon counts.
const answersAsDaemon = async (port: number, pid: number): Promise<boolean> => {
  const res = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(1_000),
  });
  const body = (await res.json()) as { service?: unknown; pid?: unknown };
  return body.service === 'agentage-daemon' && body.pid === pid;
};

// installation.json belongs to the daemon that runs on configDir; its own process may write it.
export const assertNoOtherDaemon = async (configDir: string): Promise<void> => {
  const file = await readJsonFile<{ pid?: number; port?: number } | null>(
    join(configDir, 'daemon.json'),
    null
  ).catch(() => null);
  const { pid, port } = file ?? {};
  if (!pid || !port || pid === process.pid || !alive(pid)) return;
  if (!(await answersAsDaemon(port, pid).catch(() => false))) return;
  throw fail('CONFLICT', `a daemon (process ${pid}) runs on ${configDir}: change it through it`, {
    code: 'DAEMON_RUNNING',
    details: { pid, port },
  });
};
