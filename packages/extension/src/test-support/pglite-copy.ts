import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inject, vi } from 'vitest';
import type * as Pglite from '@electric-sql/pglite';

// PGlite as the kit loads it, but a new folder (or memory) starts as a copy of the run's template.
vi.mock('@electric-sql/pglite', async (original) => {
  const real = await original<typeof Pglite>();
  const template = inject('pgliteTemplate');
  let dump: Uint8Array<ArrayBuffer> | undefined;
  class PGlite extends real.PGlite {
    constructor(dataDir?: string) {
      if (dataDir && !existsSync(join(dataDir, 'PG_VERSION')))
        cpSync(join(template, 'data'), dataDir, { recursive: true });
      dump ??= new Uint8Array(readFileSync(join(template, 'dump.tar')));
      if (dataDir) super(dataDir);
      else super({ loadDataDir: new Blob([dump]) });
    }
  }
  return { ...real, PGlite };
});
