import { afterEach, describe, expect, it } from 'vitest';
import { HOSTED_MANIFEST, hostedPackage } from '../../extension/src/test-support/hosted-fixture.js';
import { removeTempPackages } from '../../extension/src/test-support/packages.js';
import { checkedSettings } from './patch-values.js';

const withSecrets = (secrets?: unknown[]) => {
  const agentage: Record<string, unknown> = { ...HOSTED_MANIFEST.agentage, secrets };
  if (!secrets) delete agentage['secrets'];
  return { ...HOSTED_MANIFEST, agentage };
};

afterEach(removeTempPackages);

describe('checkedSettings', () => {
  it('knows a secret declared in the object form { name, parts }', async () => {
    const dir = await hostedPackage(withSecrets([{ name: 'db-url', parts: ['api'] }]));
    await expect(checkedSettings(dir, { secrets: { 'db-url': 'x' } }, 'hosted')).resolves.toEqual(
      {}
    );
    await expect(checkedSettings(dir, { secrets: { 'api-token': 'x' } }, 'hosted')).rejects.toThrow(
      'hosted declares no secret api-token'
    );
  });

  it('a package that declares no secrets refuses every secret', async () => {
    const dir = await hostedPackage(withSecrets());
    await expect(checkedSettings(dir, { secrets: { any: 'x' } }, 'hosted')).rejects.toMatchObject({
      status: 400,
      message: 'hosted declares no secret any',
    });
    await expect(
      checkedSettings(dir, { settings: { 'echo.prefix': 'a' } }, 'hosted')
    ).resolves.toEqual({ 'echo.prefix': 'a' });
  });
});
