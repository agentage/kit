import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// The kit carries the app kit (private workspace packages/app) as @agentage/extension/app: no npm package of its own.
const root = join(import.meta.dirname, '..');
const vendor = join(root, 'packages/extension/dist/vendor/app');
rmSync(vendor, { recursive: true, force: true });
cpSync(join(root, 'packages/app/dist'), vendor, {
  recursive: true,
  filter: (src) => !/\.test\./.test(src),
});
cpSync(join(root, 'packages/app/theme.css'), join(vendor, 'theme.css'));
console.log('inline-app: vendor/app copied');
