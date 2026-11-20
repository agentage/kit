import { describe, expect, it } from 'vitest';
import { cloudEnvOf } from './cloud-env.js';

describe('AGENTAGE_CORE_URL: read by nothing, checked when set', () => {
  it('unset: the start goes on, and the env has no core key', () => {
    const env = cloudEnvOf({ AGENTAGE_URL: 'https://a.b.io' });
    expect([env.own, 'core' in env]).toEqual(['https://a.b.io', false]);
  });

  it('set to a bad value: the start is still refused', () => {
    const env = { AGENTAGE_URL: 'https://a.b.io', AGENTAGE_CORE_URL: 'http://core.b.io' };
    expect(() => cloudEnvOf(env)).toThrow('AGENTAGE_CORE_URL: not an https origin');
  });
});
