import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { NO_SWITCHER, NOT_BUILT, pixelDiff } from './diff.js';

const SHOTS = new URL('../shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const WIDTHS = [1280, 400];

for (const width of WIDTHS) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('the frame beside the prototype', async ({ page }, info) => {
      const shot = async (url: string, css: string) => {
        await page.goto(url);
        if (css) await page.addStyleTag({ content: css });
        await page.locator('[data-region="main"] .stats').waitFor();
        await page.waitForTimeout(200);
        return page.screenshot();
      };
      const frame = await shot('/fixture.html', '');
      const proto = await shot('/prototype.html', NO_SWITCHER);
      const protoBuilt = await shot('/prototype.html', NO_SWITCHER + NOT_BUILT);
      writeFileSync(`${SHOTS}frame-${width}.png`, frame);
      writeFileSync(`${SHOTS}prototype-${width}.png`, proto);
      const raw = await pixelDiff(page, frame, proto);
      const built = await pixelDiff(page, frame, protoBuilt);
      writeFileSync(`${SHOTS}diff-${width}.json`, JSON.stringify({ width, raw, built }) + '\n');
      info.annotations.push({
        type: 'pixel diff',
        description: `${width}px raw ${raw}% built ${built}%`,
      });
      expect(built).toBeLessThan(1);
      expect(raw).toBeLessThan(6);
    });

    for (const url of ['/', '/fixture.html']) {
      test(`axe WCAG A and AA: 0 violations on ${url}`, async ({ page }) => {
        await page.goto(url);
        await page.locator('[data-region="nav"]').waitFor();
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      });
    }
  });
}
