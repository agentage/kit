import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { inject } from 'vitest';

// A child process gets no vi.mock: its store folder starts as a copy of the run's initdb template.
export const seedStore = async (dataDir: string): Promise<string> => {
  await cp(join(inject('pgliteTemplate'), 'data'), dataDir, { recursive: true });
  return dataDir;
};
