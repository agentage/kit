import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 } });

test('the feed answers 502 once, the shell reconnects and hears a later event', async ({
  page,
}) => {
  const lab = (op: string) => page.request.post(`/__lab/${op}`);
  const nav = page.locator('[data-region="nav"]');
  await lab('deny-feed/1');
  const reopened = page.waitForResponse(
    (r) => r.url().endsWith('/shell/events') && r.status() === 200
  );
  await page.goto('/');
  await expect(nav.getByRole('link', { name: 'Throws' })).toBeVisible();
  await reopened;
  try {
    await lab('remove/throws');
    await expect(nav.getByRole('link', { name: 'Throws' })).toHaveCount(0);
  } finally {
    await lab('add/throws');
  }
});
