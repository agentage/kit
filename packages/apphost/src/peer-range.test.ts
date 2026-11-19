import { readFileSync } from 'node:fs';
import semver from 'semver';
import { describe, expect, it } from 'vitest';

interface Manifest {
  version: string;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifestOf = (dir: string): Manifest =>
  JSON.parse(
    readFileSync(new URL(`../../${dir}/package.json`, import.meta.url), 'utf8')
  ) as Manifest;

describe('the kit range of the app host', () => {
  // A kit minor fails here until packages/apphost moves its peer range (and its version).
  it('takes the kit of this tree', () => {
    const range = manifestOf('apphost').peerDependencies?.['@agentage/extension'] ?? '';
    expect(semver.satisfies(manifestOf('extension').version, range), range).toBe(true);
  });

  it('tests on the same range it takes as a peer', () => {
    const { peerDependencies, devDependencies } = manifestOf('apphost');
    expect(devDependencies?.['@agentage/extension']).toBe(
      peerDependencies?.['@agentage/extension']
    );
  });
});
