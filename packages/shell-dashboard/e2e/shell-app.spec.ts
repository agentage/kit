import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = new URL('../shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const main = (page: Page) => page.locator('[data-region="main"]');
const lab = (page: Page, op: string) => page.request.post(`/__lab/${op}`);

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 } });

test('an app page: rows, the user, api, notify, the details aside', async ({ page }) => {
  await page.goto('/probe');
  const nav = page.locator('[data-region="nav"]');
  await expect(nav.getByRole('link', { name: 'Probe' }).locator('svg.lucide-radar')).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Probe' })).toBeVisible();
  await expect(main(page)).toContainText('User Alex Doe');
  await main(page).getByRole('button', { name: 'Ping' }).click();
  await expect(main(page)).toContainText('pong hi');
  await main(page).getByRole('button', { name: 'Notify' }).click();
  await expect(page.getByRole('status')).toContainText('Notified');
  await expect(page.locator('[data-region="notices"] .pill')).toHaveText('1');
  await main(page).getByRole('button', { name: 'Details' }).click();
  await expect(page).toHaveURL(/\?details=1$/);
  await expect(page.locator('[data-region="aside"]')).toContainText('probe details');
  await page.screenshot({ path: `${SHOTS}app-probe-details-1280.png` });
  await expect(main(page)).toContainText('At /?details=1');
  await page.goto('/probe/runs/7?details=1');
  await expect(page.locator('[data-region="aside"]')).toContainText('probe details');
  await expect(main(page)).toContainText('At /runs/7?details=1');
});

test('a throwing app is a card in main; the nav still works; back and forward', async ({
  page,
}) => {
  await page.goto('/throws');
  await expect(main(page).getByRole('alert')).toContainText('lab app throws on render');
  await page.getByRole('link', { name: 'Probe' }).click();
  await expect(main(page).getByRole('heading', { name: 'Probe' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/throws$/);
  await expect(main(page).getByRole('alert')).toBeVisible();
  await page.goForward();
  await expect(main(page).getByRole('heading', { name: 'Probe' })).toBeVisible();
});

test('an unknown page is "not found" inside the frame (404)', async ({ page }) => {
  const res = await page.goto('/nope/x');
  expect(res?.status()).toBe(404);
  await expect(main(page)).toContainText('Not found');
  await expect(page.locator('[data-region="nav"]')).toBeVisible();
});

test('a new build of the open app is live with no reload and keeps state(key)', async ({
  page,
}) => {
  await page.goto('/probe');
  await main(page).getByLabel('Draft').fill('abc');
  await page.evaluate('window.__mark = 1');
  const t0 = Date.now();
  await lab(page, 'rebuild/probe/two');
  await expect(main(page)).toContainText('Build two', { timeout: 3000 });
  console.log(`rebuild to visible: ${Date.now() - t0} ms (target 3000)`);
  await expect(main(page).getByLabel('Draft')).toHaveValue('abc');
  expect(await page.evaluate('window.__mark')).toBe(1);
});

test('remove takes the row away; the open page says it was removed; add brings it back', async ({
  page,
}) => {
  await page.goto('/fixture');
  await expect(main(page).getByRole('heading', { name: 'Fixture' })).toBeVisible();
  await page.evaluate('window.__mark = 1');
  await lab(page, 'remove/fixture');
  await expect(main(page)).toContainText('Fixture was removed');
  await expect(page.getByRole('link', { name: 'Fixture' })).toHaveCount(0);
  await lab(page, 'add/fixture');
  await expect(page.getByRole('link', { name: 'Fixture' })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Fixture' })).toBeVisible();
  expect(await page.evaluate('window.__mark')).toBe(1);
});

test('app panes: the tree size holds across a reload with no layout shift', async ({ page }) => {
  await page.goto('/fixture');
  const sep = page.getByRole('separator', { name: 'Resize tree' });
  await sep.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(sep).toHaveAttribute('aria-valuenow', '272');
  await page.reload();
  await expect(sep).toHaveAttribute('aria-valuenow', '272');
  const cls = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        let sum = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as (PerformanceEntry & { value: number })[])
            sum += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => done(sum), 500);
      })
  );
  expect(cls).toBe(0);
});

for (const width of [1280, 400])
  test(`axe WCAG A and AA: 0 on /probe, /fixture and /nope/x at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/probe', '/fixture', '/nope/x']) {
      await page.goto(path);
      await expect(main(page).locator('h1, [role="alert"], [data-page]').first()).toBeVisible();
      if (path === '/probe') await page.screenshot({ path: `${SHOTS}app-probe-${width}.png` });
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(
        r.violations.map((v) => `${v.id}: ${v.nodes.length}`),
        path
      ).toEqual([]);
    }
  });
