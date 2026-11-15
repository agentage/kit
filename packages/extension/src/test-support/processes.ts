import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

export const alive = (pid: number): boolean => {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
};

// The pid of a process that has exited: a stale lock holder.
export const deadPid = (): number => spawnSync(process.execPath, ['-e', '']).pid ?? 0;

export const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
