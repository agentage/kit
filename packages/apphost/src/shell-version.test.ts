import { describe, expect, it } from 'vitest';
import { json, tempPackage } from '../../extension/src/test-support/packages.js';
import { readShell } from './shell-routes.js';

describe('readShell version', () => {
  it('reports the version it is given (the kit) over the shell package version', async () => {
    const dir = await tempPackage({
      'package.json': json({ name: '@agentage/shell-dashboard', version: '0.1.0' }),
    });
    expect((await readShell(dir)).version).toBe('0.1.0');
    expect((await readShell(dir, '0.18.4')).version).toBe('0.18.4');
  });
});
