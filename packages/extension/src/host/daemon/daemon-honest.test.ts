import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startHarness,
  tempConfigDir,
  writeSecrets,
  type Harness,
} from '../../test-support/daemon-harness.js';
import { inProcessLaunch } from '../../test-support/in-process-launch.js';
import { hostedPackage } from '../../test-support/hosted-fixture.js';
import { type Launch } from './child.js';
import { readJsonFile } from './json-file.js';
import { type Installer } from './supervisor.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const UNREADABLE = { status: 409, body: { error: { code: 'INSTALLATION_UNREADABLE' } } };
const doc = () => readJsonFile(join(h!.configDir, 'installation.json'), {});

describe('POST /host/extensions with enabled: false', () => {
  it('records a folder disabled and never starts it; enable starts it', async () => {
    const launch = vi.fn<Launch>(inProcessLaunch);
    h = await startHarness({ launch });
    await writeSecrets(h.configDir);
    const dir = await hostedPackage();
    const added = await h.call('POST', '/host/extensions', { source: dir, enabled: false });
    expect(added).toMatchObject({
      status: 201,
      body: { data: { id: 'hosted', version: '1.0.0', state: 'disabled' } },
    });
    expect(launch).not.toHaveBeenCalled();
    expect(await doc()).toEqual({
      host: 'local',
      extensions: [{ id: 'hosted', source: dir, enabled: false }],
    });
    expect((await h.call('GET', '/api/hosted/echo')).status).toBe(404);
    await h.call('PATCH', '/host/extensions/hosted', { enabled: true });
    expect((await h.call('GET', '/api/hosted/echo')).status).toBe(200);
  });

  it('installs { id } once, starts nothing, and an enable calls no installer again', async () => {
    const dir = await hostedPackage();
    const install = vi.fn<Installer>(async ({ id }) => ({ id, version: '1.0.0', dir }));
    const launch = vi.fn<Launch>(inProcessLaunch);
    h = await startHarness({ install, launch });
    await writeSecrets(h.configDir);
    const added = await h.call('POST', '/host/extensions', { id: 'hosted', enabled: false });
    expect(added.body).toMatchObject({ data: { version: '1.0.0', state: 'disabled' } });
    expect(launch).not.toHaveBeenCalled();
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({
      data: [{ id: 'hosted', state: 'disabled', enabled: false, source: 'market' }],
    });
    await h.call('PATCH', '/host/extensions/hosted', { enabled: true });
    expect(install).toHaveBeenCalledTimes(1);
    expect((await h.call('GET', '/api/hosted/echo')).status).toBe(200);
  });
});

describe('an installation.json that cannot be read', () => {
  it('at boot (EISDIR): /health says unreadable, every change is 409, the file is never written', async () => {
    const configDir = await tempConfigDir();
    await mkdir(join(configDir, 'installation.json', 'inside'), { recursive: true });
    h = await startHarness({ configDir });
    expect((await h.call('GET', '/health')).body).toMatchObject({
      status: 'degraded',
      installation: 'unreadable',
      installationError: 'EISDIR',
    });
    const source = await hostedPackage();
    expect(await h.call('POST', '/host/extensions', { source })).toMatchObject(UNREADABLE);
    expect(await h.call('DELETE', '/host/extensions/hosted')).toMatchObject(UNREADABLE);
    const refused = await h.call('POST', '/host/extensions', { source });
    expect((refused.body as { error: { message: string } }).error.message).toBe(
      'installation.json cannot be read (EISDIR): fix it, then restart the daemon; no change is written'
    );
    expect(await readdir(join(configDir, 'installation.json'))).toEqual(['inside']);
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({ data: [] });
  });

  it('after boot: PATCH and DELETE are 409, the child runs on, the list and the file agree', async () => {
    h = await startHarness();
    await writeSecrets(h.configDir);
    await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    const file = join(h.configDir, 'installation.json');
    const kept = await readJsonFile(file, {});
    await rm(file);
    await mkdir(file);
    const patch = { settings: { 'echo.prefix': 'hey' } };
    expect(await h.call('PATCH', '/host/extensions/hosted', patch)).toMatchObject(UNREADABLE);
    expect(await h.call('PATCH', '/host/extensions/hosted', { enabled: false })).toMatchObject(
      UNREADABLE
    );
    expect(await h.call('DELETE', '/host/extensions/hosted')).toMatchObject(UNREADABLE);
    expect(await h.call('GET', '/api/hosted/echo?msg=hi')).toMatchObject({
      status: 200,
      body: { data: { msg: 'hi' } },
    });
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({
      data: [{ id: 'hosted', state: 'running', enabled: true }],
    });
    expect((await stat(file)).isDirectory()).toBe(true);
    await rm(file, { recursive: true });
    expect(kept).toMatchObject({ extensions: [{ id: 'hosted' }] });
  });
});
