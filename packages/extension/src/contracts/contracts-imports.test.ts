import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { externalImports } from '../test-support/import-graph.js';

const here = resolve(import.meta.dirname);

// Clients read the wire schemas; no node builtin, server or store dependency may come with them.
describe('contracts entry', () => {
  it('loads zod and nothing else', () => {
    expect(externalImports(join(here, 'index.ts'))).toEqual(['zod']);
  });

  // ./host reaches express through host-extension.js; the combine must stay off that stack.
  it('the combine loads zod and nothing else', () => {
    expect(externalImports(join(here, '..', 'discovery', 'combine.ts'))).toEqual(['zod']);
  });
});
