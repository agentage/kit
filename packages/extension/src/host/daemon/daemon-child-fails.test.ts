import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { HOSTED_MANIFEST, hostedPackage } from '../../test-support/hosted-fixture.js';
import { BUILT_MAIN as MAIN } from '../../test-support/launch-spec.js';
import { forkLaunch } from './child.js';
import { dataDirOf } from './daemon-files.js';

let h: Harness;
const manifestOf = (id: string) => ({
  ...HOSTED_MANIFEST,
  agentage: { ...HOSTED_MANIFEST.agentage, id },
});

beforeAll(async () => {
  if (!existsSync(MAIN)) throw new Error(`${MAIN} is missing: npm run build first`);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  // Default startMs and healthMs: a store open under a busy CI stays inside them.
  h = await startHarness({ launch: forkLaunch(MAIN) });
  await writeSecrets(h.configDir, ['mig', 'pg']);
});
afterAll(async () => {
  await h.daemon.stop();
  vi.restoreAllMocks();
});

describe('a forked child that cannot open its store', () => {
  it('a failing migration: 400 START_FAILED with its reason, no row left', async () => {
    const dir = await hostedPackage(manifestOf('mig'));
    await writeFile(join(dir, 'migrations', '001-hits.sql'), 'create tabel hits (n int);\n');
    const reason = 'migration 001-hits.sql failed: syntax error at or near "tabel"';
    expect(await h.call('POST', '/host/extensions', { source: dir })).toMatchObject({
      status: 400,
      body: { error: { details: { code: 'START_FAILED', reason } } },
    });
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({ data: [] });
  }, 90_000);

  it('a data folder PGlite cannot read: refused with the reason; the folder stays', async () => {
    const data = dataDirOf(h.configDir, 'pg');
    await mkdir(data, { recursive: true });
    await writeFile(join(data, 'PG_VERSION'), 'garbage\n');
    const source = await hostedPackage(manifestOf('pg'));
    expect(await h.call('POST', '/host/extensions', { source })).toMatchObject({
      status: 400,
      body: {
        error: {
          details: { code: 'START_FAILED', reason: 'PGlite failed to initialize properly' },
        },
      },
    });
    // Not made by this install: the standing rule keeps it.
    expect(existsSync(join(data, 'PG_VERSION'))).toBe(true);
  }, 90_000);
});
