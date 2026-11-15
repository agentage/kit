import { describe, expect, it } from 'vitest';
import * as host from '../host/index.js';
import * as tool from './index.js';

describe('capabilities', () => {
  it('names what the kit can do, frozen, the same list from tool and host', () => {
    expect(tool.capabilities).toEqual([
      'container',
      'localOnly',
      'installDisabled',
      'updateInstallation',
      'withFileLock',
    ]);
    expect(Object.isFrozen(tool.capabilities)).toBe(true);
    expect(host.capabilities).toBe(tool.capabilities);
  });
});
