import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { type TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgliteTemplate: string;
  }
}

// One initdb per run (about 5 s of CPU each): every in-process store starts from a copy of it.
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(join(tmpdir(), 'agentage-pglite-template-'));
  const db = new PGlite(join(dir, 'data'));
  await db.query('select 1');
  await writeFile(
    join(dir, 'dump.tar'),
    Buffer.from(await (await db.dumpDataDir('none')).arrayBuffer())
  );
  await db.close();
  project.provide('pgliteTemplate', dir);
  return () => rm(dir, { recursive: true, force: true });
}
