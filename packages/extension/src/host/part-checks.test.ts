import { describe, expect, it } from 'vitest';
import { healthRegistrar } from '../context/context.js';
import { type HealthCheck } from '../health/health.js';
import { partChecks } from './part-checks.js';

const ok: HealthCheck = async () => 'ok';
const degraded: HealthCheck = async () => 'degraded';
const broken: HealthCheck = async () => {
  throw new Error('down');
};

describe('partChecks: one map of checks for every part of a host', () => {
  it('a name two parts register runs both checks; the worse status wins', async () => {
    const shared: Record<string, HealthCheck> = { store: ok };
    const reserved = new Set(Object.keys(shared));
    healthRegistrar(partChecks(shared, reserved))('github', ok);
    healthRegistrar(partChecks(shared, reserved))('github', degraded);
    expect(await shared['github']?.()).toBe('degraded');
    healthRegistrar(partChecks(shared, reserved))('github', broken);
    expect(await shared['github']?.()).toBe('unavailable');
  });

  it('one part that registers a name twice, or a host check name, is still refused', () => {
    const shared: Record<string, HealthCheck> = { store: ok };
    const api = healthRegistrar(partChecks(shared, new Set(['store'])));
    api('github', ok);
    expect(() => api('github', ok)).toThrow('health check github: taken');
    expect(() => api('store', ok)).toThrow('health check store: taken');
  });
});
