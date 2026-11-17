import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.length}`);
};

for (const width of [1280, 400]) {
  test.describe(`slots at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('the title menu lists the app pages; axe 0 while open', async ({ page }) => {
      await page.goto('/fixture.html');
      const ttl = page.getByRole('button', { name: 'Overview, pages' });
      await ttl.click();
      await expect(ttl).toHaveAttribute('aria-expanded', 'true');
      const items = page.getByRole('menuitem');
      await expect(items).toHaveText(['Overview', 'Last 24 h', 'Last 7 d']);
      expect(await axe(page)).toEqual([]);
      await items.nth(1).click();
      expect(new URL(page.url()).pathname).toBe('/platform/1');
    });

    test('the aside closes with Escape; axe 0 while open', async ({ page }) => {
      await page.goto('/fixture.html?aside=1');
      const aside = page.locator('[data-region="aside"]');
      await expect(aside).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await page.keyboard.press('Escape');
      expect(new URL(page.url()).search).toBe('');
    });

    test('with no extension, main says how to install one; axe 0', async ({ page }) => {
      await page.route('**/.well-known/agentage-host.json', (r) =>
        r.fulfill({ json: { host: 'local', extensions: [] } })
      );
      await page.goto('/');
      await expect(page.locator('[data-page="empty"]')).toContainText('No extensions');
      // No built-in nav row: the left menu comes only from extensions.
      await expect(page.locator('[data-region="nav"] .mid > .row:not(.search)')).toHaveCount(0);
      await expect(page.locator('[data-region="nav"] .mid')).not.toContainText('Inbox');
      expect(await axe(page)).toEqual([]);
    });
  });
}

test.describe('desktop only', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the hidden nav peeks on the show button and leaves 200 ms after', async ({ page }) => {
    await page.goto('/fixture.html');
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    const nav = page.locator('nav.side');
    await page.getByRole('button', { name: 'Show sidebar' }).hover();
    await expect(nav).toHaveClass(/peek/);
    await expect(nav).toBeVisible();
    await page.mouse.move(900, 400);
    await expect(nav).not.toHaveClass(/peek/);
  });

  test('the mobile-only avatar is hidden; the account menu has the command list', async ({
    page,
  }) => {
    await page.goto('/fixture.html');
    await page.locator('.acct').click();
    await expect(page.getByRole('menuitem', { name: 'Command list' })).toBeVisible();
  });
});
