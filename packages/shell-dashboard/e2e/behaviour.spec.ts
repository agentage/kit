import { expect, test, type Page } from '@playwright/test';

const nav = (page: Page) => page.locator('[data-region="nav"]');
const navSep = (page: Page) => page.getByRole('separator', { name: 'Resize sidebar' });

const cls = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((done) => {
        let sum = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & { value: number })[])
            sum += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => done(sum), 500);
      })
  );

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('regions carry the prototype names; color-scheme dark', async ({ page }) => {
    await page.goto('/fixture.html');
    for (const r of ['nav', 'notices', 'account', 'main', 'actions', 'aside', 'bottom', 'side'])
      await expect(page.locator(`[data-region="${r}"]`)).toHaveCount(1);
    const scheme = await page.evaluate(() => getComputedStyle(document.body).colorScheme);
    expect(scheme).toBe('dark');
    await expect(page.locator('[data-region="account"]')).toContainText('shell 0.1.0');
  });

  test('nav splitter: drag to 320 px, collapse, reload: kept, CLS 0', async ({ page }) => {
    await page.goto('/fixture.html');
    const box = (await navSep(page).boundingBox())!;
    await page.mouse.move(box.x + 3, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 3 + 40, box.y + 300, { steps: 4 });
    await page.mouse.up();
    await expect(navSep(page)).toHaveAttribute('aria-valuenow', '320');
    await page.reload();
    expect(Math.round((await nav(page).boundingBox())!.width)).toBe(320);
    expect(await cls(page)).toBe(0);
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
    await expect(nav(page)).toBeHidden();
    expect(await cls(page)).toBe(0);
  });

  test('keyboard: ArrowLeft on a splitter moves 16 px; Ctrl+K opens the command list', async ({
    page,
  }) => {
    await page.goto('/fixture.html');
    await navSep(page).focus();
    const before = Number(await navSep(page).getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowLeft');
    await expect(navSep(page)).toHaveAttribute('aria-valuenow', String(before - 16));
    await page.keyboard.press('Control+k');
    const list = page.getByRole('dialog', { name: 'Command list' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option', { name: 'Go to Memory' })).toBeVisible();
    await expect(list.getByRole('option', { name: 'Toggle sidebar' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
  });

  test('the aside opens with its own splitter', async ({ page }) => {
    await page.goto('/fixture.html?aside=1');
    await expect(page.locator('[data-region="aside"]')).toBeVisible();
    await expect(page.getByRole('separator', { name: 'Resize aside' })).toBeVisible();
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test('the mobile header shows, no horizontal scroll, the nav opens as a drawer', async ({
    page,
  }) => {
    await page.goto('/fixture.html');
    await expect(page.locator('[data-region="mobile-header"]')).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBe(400);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('link', { name: 'Memory' })).toBeInViewport();
  });
});
