import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { startCloudHost } from './cloud-host.js';
import { PROGRAM_VERSION } from './program-version.js';
import {
  closeUpstreams,
  cloudEnv,
  quietLog,
  startCloud,
  type Started,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const NO_ROWS = { extensions: [], upstreams: [] };
const COMMIT = 'c'.repeat(40);

// The env of a host whose installation.json is changed by `edit`.
const envWith = async (edit: (doc: Record<string, unknown>) => unknown, extra = {}) => {
  const env = await cloudEnv(NO_ROWS, extra);
  const doc = JSON.parse(await readFile(env.AGENTAGE_INSTALLATION_FILE, 'utf8')) as object;
  await writeFile(env.AGENTAGE_INSTALLATION_FILE, JSON.stringify(edit({ ...doc })));
  return env;
};

const refusal = (env: NodeJS.ProcessEnv) => startCloudHost(env, { log: quietLog() });

describe('the start uses the checks of --check', () => {
  it('a program line of another version refuses the start', async () => {
    const env = await envWith((doc) => ({ ...doc, program: { version: '9.9.9' } }));
    await expect(refusal(env)).rejects.toThrow(
      `program.version: 9.9.9, this program is ${PROGRAM_VERSION}`
    );
  });

  it('the old form refuses the start: no program line, a shell version', async () => {
    const env = await envWith(({ program: _program, ...doc }) => ({
      ...doc,
      shell: { package: '@agentage/shell-dashboard', version: '0.3.1' },
    }));
    const refused = refusal(env);
    await expect(refused).rejects.toThrow('program: is required');
    await expect(refused).rejects.toThrow('shell.version: is gone');
  });

  it('a machine row (source, enabled) refuses the start', async () => {
    const row = { id: 'echo', version: '1.0.0', enabled: true };
    const env = await envWith((doc) => ({ ...doc, extensions: [row] }));
    await expect(refusal(env)).rejects.toThrow('enabled: is for a machine only');
  });

  it('VERSION of another program refuses the start', async () => {
    const env = await cloudEnv(NO_ROWS, { VERSION: '9.9.9' });
    await expect(refusal(env)).rejects.toThrow(`VERSION 9.9.9: not the version of this program`);
  });
});

describe('the host document reports the program that serves it', () => {
  const docOf = async (extra: Record<string, string>) => {
    host = await startCloud(await cloudEnv(NO_ROWS, extra));
    return JSON.parse((await host.call('/.well-known/agentage-host.json')).body) as object;
  };

  it('program: the version of this program and COMMIT_SHA', async () => {
    expect(await docOf({ VERSION: PROGRAM_VERSION, COMMIT_SHA: COMMIT })).toEqual({
      host: 'site',
      kind: 'cloud',
      program: { version: PROGRAM_VERSION, commit: COMMIT },
      extensions: [],
    });
  });

  it('no program key when COMMIT_SHA is not a full sha (a local build)', async () => {
    expect(await docOf({ COMMIT_SHA: 'abcdef1' })).not.toHaveProperty('program');
  });
});
