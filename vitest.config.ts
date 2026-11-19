import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The program's tests run the kit from source, as the kit's own tests do: one copy of each module.
    alias: {
      '@agentage/extension/internal': fileURLToPath(
        new URL('./packages/extension/src/internal/index.ts', import.meta.url)
      ),
    },
  },
  test: {
    // An in-process postgres boots in seconds when the whole suite runs at once (tests and hooks).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    globalSetup: ['packages/extension/src/test-support/pglite-template.ts'],
    setupFiles: [
      'packages/extension/src/test-support/cleanup.ts',
      'packages/extension/src/test-support/pglite-copy.ts',
      'packages/extension/src/test-support/wait-bound.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        'packages/*/src/test-support/**',
        '**/index.ts',
        'packages/extension/src/runtime/main.ts',
        'packages/extension/src/host/main.ts',
        'packages/apphost/src/cloud-main.ts',
        'packages/extension/src/tool/cli.ts',
        'packages/extension/src/schemas/write-schemas.ts',
        'packages/widget/src/bundle/cli.ts',
        'packages/widget/src/harness/main.ts',
        'packages/widget/src/ds/styles.generated.ts',
        'packages/shell-dashboard/src/main.tsx',
      ],
      thresholds: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
  },
});
