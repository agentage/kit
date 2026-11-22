import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = new URL('../shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const main = (page: Page) => page.locator('[data-region="main"]');
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.length}`);
};

for (const width of [1280, 400]) {
  test.describe(`notices at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('one toast per kind, axe 0; the inbox keeps them after 5 s', async ({ page }) => {
      await page.goto('/probe');
      for (const name of ['Notify', 'Say ok', 'Say error'])
        await main(page).getByRole('button', { name, exact: true }).click();
      const toasts = page.locator('[data-slot="toast"]');
      await expect(toasts).toHaveCount(3);
      await page.screenshot({ path: `${SHOTS}toasts-${width}.png` });
      expect(await axe(page)).toEqual([]);
      await expect(toasts).toHaveCount(0, { timeout: 7000 });
      const inboxBtn =
        width < 760
          ? page.locator('[data-region="mobile-header"]').getByRole('button', { name: 'Inbox' })
          : page.locator('[data-region="notices"] button');
      await inboxBtn.click();
      const inbox = page.locator('[data-inbox]');
      for (const t of ['Notified', 'Saved', 'Broke']) await expect(inbox).toContainText(t);
      await expect(page.locator('[data-region="notices"] .pill')).toBeHidden();
      await page.screenshot({ path: `${SHOTS}inbox-${width}.png` });
      expect(await axe(page)).toEqual([]);
    });

    test('the title page menu of the open app, axe 0 while open', async ({ page }) => {
      await page.goto('/probe');
      const ttl = page.getByRole('button', { name: 'Probe, pages' });
      await ttl.click();
      await expect(page.getByRole('menuitem')).toHaveText(['Probe', 'Runs']);
      expect(await axe(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Runs' }).click();
      await expect(page).toHaveURL(/\/probe\/runs$/);
      await expect(page.locator('[data-region="bottom"] .bhead')).toContainText('Probe log');
    });
  });
}

test('the open app lists its nav section below the app rows; axe 0', async ({ page }) => {
  await page.goto('/probe/work');
  const group = page.getByRole('group', { name: 'Memories' });
  await expect(group.getByRole('link')).toHaveText(['personal', 'work', 'agentage']);
  await expect(group.getByRole('link', { name: 'work' })).toHaveAttribute('aria-current', 'page');
  expect(await axe(page)).toEqual([]);
  await group.getByRole('link', { name: 'agentage' }).click();
  await expect(page).toHaveURL(/\/probe\/agentage$/);
  await expect(group.getByRole('link', { name: 'agentage' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await page.getByRole('link', { name: 'Fixture' }).click();
  await expect(page.getByRole('group')).toHaveCount(0);
});

test.describe('CLS with the app bars', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  const cls = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<number>((done) => {
          let sum = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as (PerformanceEntry & { value: number })[])
              sum += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
          setTimeout(() => done(sum), 800);
        })
    );

  for (const open of [false, true])
    test(`a cold /probe fills the title menu and bottom bar with CLS 0 (bottom ${open ? 'open' : 'closed'})`, async ({
      page,
    }) => {
      await page.addInitScript((o) => localStorage.setItem('ag.bot.open', o ? '1' : '0'), open);
      await page.goto('/probe');
      await expect(page.locator('[data-region="bottom"] .bhead')).toContainText('Probe log');
      await expect(page.getByRole('button', { name: 'Probe, pages' })).toBeVisible();
      expect(await cls(page)).toBe(0);
    });
});
