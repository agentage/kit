import { expect, test, type Page } from '@playwright/test';

// A cloud host signed in has Sign out in the account menu; the daemon has none.
const account = (page: Page) => page.locator('[data-region="account"]');
const lab = (page: Page, op: string) => page.request.post(`/__lab/session/${op}`);
const signOut = (page: Page) => page.getByRole('menuitem', { name: 'Sign out' });

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 } });
test.afterEach(async ({ page }) => void (await lab(page, 'in')));

test('a cloud host: Sign out ends the session, the Sign in link shows, no reload', async ({
  page,
}) => {
  await lab(page, 'cloud');
  await page.goto('/');
  await expect(account(page)).toContainText('Alex Doe');
  await page.evaluate(() => Object.assign(window, { samePage: true }));
  await account(page).getByRole('button', { name: 'Account menu' }).click();
  const post = page.waitForRequest((r) => r.url().endsWith('/shell/sign-out'));
  await signOut(page).click();
  expect((await post).method()).toBe('POST');
  await expect(account(page).getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(account(page)).not.toContainText('Alex Doe');
  expect(await page.evaluate(() => 'samePage' in window), 'no page reload').toBe(true);
});

test('the local daemon (no signOut) has no Sign out item', async ({ page }) => {
  await page.goto('/');
  await expect(account(page)).toContainText('Alex Doe');
  await account(page).getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Command list' })).toBeVisible();
  await expect(signOut(page)).toHaveCount(0);
});
