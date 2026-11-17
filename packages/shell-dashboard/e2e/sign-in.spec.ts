import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// A cloud host signed out: the account region is a Sign in link in the same box (owner 2026-11-17, S4 A4).
const account = (page: Page) => page.locator('[data-region="account"]');
const lab = (page: Page, op: string) => page.request.post(`/__lab/session/${op}`);
const box = async (page: Page) => account(page).locator('.acct').boundingBox();

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 } });
test.afterEach(async ({ page }) => void (await lab(page, 'in')));

test('signed out on a cloud host: a Sign in link, the same box, 0 axe violations', async ({
  page,
}) => {
  await page.goto('/');
  await expect(account(page)).toContainText('Alex Doe');
  const signedIn = await box(page);
  await lab(page, 'out');
  const link = account(page).getByRole('link', { name: 'Sign in' });
  await expect(link).toHaveAttribute('href', '/__sign-in?next=%2F');
  await expect(account(page)).not.toContainText('agentage setup');
  expect(await box(page), 'no layout shift').toEqual(signedIn);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('the mobile header: the avatar is the Sign in link', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto('/');
  await lab(page, 'out');
  await expect(page.locator('.mh').getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('the local daemon (no signIn) keeps its hint', async ({ page }) => {
  await page.goto('/');
  await expect(account(page).getByRole('link')).toHaveCount(0);
  await expect(account(page)).toContainText('Alex Doe');
});
