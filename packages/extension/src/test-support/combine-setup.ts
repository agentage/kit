import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Answer, type Combined, type HostInstallation } from '../discovery/combine.js';

const FIXTURES = join(import.meta.dirname, 'combine');

export const read = async (name: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;

// Two extension documents and the installation of the golden file.
export const setup = async () => ({
  probe: await read('probe.json'),
  fixture: await read('fixture.json'),
  installation: (await read('installation.json')) as unknown as HostInstallation,
});

export const at = (id: string, document: unknown): Answer => ({
  upstream: `http://${id}:8080`,
  document,
});

export const entry = (out: Combined, id: string) =>
  out.document.extensions.find((e) => e.id === id);
