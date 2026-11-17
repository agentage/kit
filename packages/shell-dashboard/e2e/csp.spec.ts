import { expect, test, type Page } from '@playwright/test';

interface Violation {
  blocked: string;
  directive: string;
}
declare global {
  interface Window {
    cspViolations: Violation[];
  }
}

const main = (page: Page) => page.locator('[data-region="main"]');

// Each test records the policy violations and the console errors that name the policy.
const watch = async (page: Page) => {
  const errors: string[] = [];
  page.on('console', (m) => /Content Security Policy/i.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.cspViolations.push({ blocked: e.blockedURI, directive: e.effectiveDirective })
    );
  });
  return errors;
};
const violations = (page: Page) => page.evaluate(() => window.cspViolations);

test('the shell page and an app page run under the policy with no violation', async ({ page }) => {
  const errors = await watch(page);
  const res = await page.goto('/probe');
  expect(await res?.text()).toContain('http-equiv="Content-Security-Policy"');
  await expect(main(page).getByRole('heading', { name: 'Probe' })).toBeVisible();
  await main(page).getByRole('button', { name: 'Ping' }).click();
  await expect(main(page)).toContainText('pong hi');
  await main(page).getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('[data-region="aside"]')).toContainText('probe details');
  await page.getByRole('link', { name: 'Probe' }).click();
  expect(await violations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a script from another origin is refused', async ({ page }) => {
  await watch(page);
  await page.goto('/probe');
  await expect(main(page).getByRole('heading', { name: 'Probe' })).toBeVisible();
  const loaded = await page.evaluate(
    (url) =>
      import(url).then(
        () => 'loaded',
        () => 'refused'
      ),
    'https://example.invalid/x.js'
  );
  expect(loaded).toBe('refused');
  await expect
    .poll(() => violations(page))
    .toContainEqual(
      expect.objectContaining({ blocked: expect.stringContaining('example.invalid') })
    );
});
