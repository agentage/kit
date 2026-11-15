import { describe, expect, it } from 'vitest';
import * as host from '../host/index.js';
import * as tool from './index.js';

describe('capabilities', () => {
  it('names container and localOnly, frozen, the same list from tool and host', () => {
    expect(tool.capabilities).toEqual(['container', 'localOnly']);
    expect(Object.isFrozen(tool.capabilities)).toBe(true);
    expect(host.capabilities).toBe(tool.capabilities);
  });
});
