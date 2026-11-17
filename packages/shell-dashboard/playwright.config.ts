import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SHELL_E2E_PORT ?? 4291);

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://127.0.0.1:${port}/fixture.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
