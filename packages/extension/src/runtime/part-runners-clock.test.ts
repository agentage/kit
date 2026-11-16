import { type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkModules } from '../test-support/http.js';
import { json, tempPackage } from '../test-support/packages.js';
import { runPart } from './run-part.js';

const MANIFEST = {
  name: '@agentage/extension-probe',
  version: '0.2.0',
  engines: { agentage: '^0.2' },
  agentage: { id: 'probe', parts: { pages: true, worker: true } },
};
const STOP = 'SIGUSR2' as const;

beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(() => {
  process.emit(STOP, STOP);
  vi.restoreAllMocks();
});

describe('cloud worker part and the test clock', () => {
  it('AGENTAGE_CLOCK_RATE=60 in its env changes nothing: the job still waits for the real minute', async () => {
    // A real run in the next 1.6 s would be a real minute edge, not the clock.
    if (new Date().getSeconds() >= 57) await new Promise((r) => setTimeout(r, 4000));
    const marker = `${process.env['TMPDIR'] ?? '/tmp'}/clock-${process.pid}-${Date.now()}`;
    const files = {
      'package.json': json(MANIFEST),
      'dist/pages/index.js': "export const create = () => ({ '/': 'x' });\n",
      'dist/worker/index.js': `import { writeFileSync } from 'node:fs'; export const create = ({ schedule }) => { schedule('tick', '* * * * *', () => writeFileSync(${JSON.stringify(marker)}, 'ran')); };\n`,
    };
    const dir = await tempPackage(files);
    await linkModules(dir);
    const server: Server = await runPart({
      dir,
      part: 'worker',
      env: { PORT: '0', AGENTAGE_CLOCK_RATE: '60' },
      serve: { signals: [STOP], exit: () => undefined },
    });
    await new Promise((r) => setTimeout(r, 1600));
    expect(existsSync(marker)).toBe(false);
    server.close();
  });
});
