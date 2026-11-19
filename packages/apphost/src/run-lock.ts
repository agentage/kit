import { readFile, unlink } from 'node:fs/promises';

const pidIn = (lock: string): Promise<number> => readFile(lock, 'utf8').then(Number, () => 0);

// Linux: a child of this run folder has it in its env; a reused pid or a zombie does not.
const childOf = async (pid: number, runDir: string): Promise<boolean> => {
  if (process.platform !== 'linux') return true;
  const env = await readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '');
  return env.split('\0').includes(`AGENTAGE_RUN_DIR=${runDir}`);
};

// The daemon starts one child per id at a time: a lock not held by a child of this id is left over.
export const clearRunLock = async (lock: string, runDir: string): Promise<void> => {
  const pid = await pidIn(lock);
  if (pid > 0 && !(await childOf(pid, runDir))) await unlink(lock).catch(() => undefined);
};
