import type { Page } from '@playwright/test';

// Share of pixels whose RGB distance is over 24, computed in the page (no image library).
export const pixelDiff = async (page: Page, a: Buffer, b: Buffer): Promise<number> =>
  page.evaluate(
    async ([x, y]: [string, string]) => {
      const load = async (s: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${s}`;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const [p, q] = [await load(x), await load(y)];
      let n = 0;
      for (let k = 0; k < p.length; k += 4) {
        const d =
          Math.abs(p[k]! - q[k]!) +
          Math.abs(p[k + 1]! - q[k + 1]!) +
          Math.abs(p[k + 2]! - q[k + 2]!);
        if (d > 24) n++;
      }
      return Math.round((n / (p.length / 4)) * 10000) / 100;
    },
    [a.toString('base64'), b.toString('base64')] as [string, string]
  );

// Content, not chrome: main below the actions bar, the action buttons, the nav app
// rows (they come from discovery), the account text, the prototype's Recent list and log lines.
export const CONTENT = [
  '[data-region="main"] > :not(.abar)',
  '.abar .agrp > *',
  '.mid > .row:not(.search)',
  '.who',
  '.bhead .err',
].join(', ');
export const CHROME_ONLY = `${CONTENT} { visibility: hidden !important; }`;
// The prototype's Inbox nav row: the shell has no built-in nav row (its inbox is in the foot).
export const NOT_CHROME = '.sect, #recent, #inboxBtn { display: none !important; }';
export const NO_SWITCHER = '#sw { display: none !important; }';
