// K0 spike run: builds, serves, drives Chromium, writes evidence/results.json and screenshots.
import { readFile, stat, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { appContext, buildShell, buildVendor, clean, out } from './build.mjs';
import { startServer } from './server.mjs';

const here = new URL('.', import.meta.url).pathname;
const ev = (f) => join(here, 'evidence', f);
const ms = (a, b) => Math.round((b - a) * 10) / 10;
const timed = async (fn) => {
  const t = performance.now();
  const r = await fn();
  return [ms(t, performance.now()), r];
};
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], max: s[s.length - 1], min: s[0] };
};
const R = { cold: {}, bytes: {}, oneReact: {}, region: {}, loop: [], state: {}, split: {} };

await clean();
[R.cold.vendorMs] = await timed(buildVendor);
[R.cold.shellMs] = await timed(buildShell);
const ctx = {};
const entries = {};
for (const id of ['probe', 'memory', 'fat']) {
  ctx[id] = await appContext(id, { externals: id !== 'fat' });
  const [t, r] = await timed(ctx[id].rebuild);
  R.cold[`${id}Ms`] = t;
  R.bytes[`app-${id}`] = r.bytes;
  entries[id] = r.entry;
}
for (const f of await readdir(join(out, 'shell/vendor')))
  R.bytes[`vendor/${f}`] = (await stat(join(out, 'shell/vendor', f))).size;

const rows = [
  { id: 'probe', title: 'Probe' },
  { id: 'memory', title: 'Memory' },
  { id: 'fat', title: 'Fat (own React)' },
].map((r) => ({ ...r, entry: entries[r.id] }));
const srv = await startServer(rows);
const base = `http://127.0.0.1:${srv.port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const vendorReqs = [];
page.on(
  'request',
  (q) => q.url().includes('/shell/vendor/') && vendorReqs.push(new URL(q.url()).pathname)
);

await page.goto(`${base}/probe?details=1`);
await page.getByTestId('label').waitFor();
await page.getByTestId('draft').fill('abc');
await page.getByTestId('plain').fill('xyz');
await page.evaluate(() => (window.__mark = 1));
R.oneReact.hookRefsShellProbe = await page.evaluate(() => window.__hooks.size);
R.region.asideText = await page.getByTestId('aside-probe').textContent();
R.region.asideInsideAsideRegion = await page.evaluate(
  () => !!document.querySelector('[data-region="aside"] [data-testid="aside-probe"]')
);
R.region.actionsText = await page.locator('[data-region="actions"]').textContent();
await page.screenshot({ path: ev('01-probe-region.png') });

const src = join(here, 'apps/probe/index.tsx');
const orig = await readFile(src, 'utf8');
for (let i = 1; i <= 10; i++) {
  await writeFile(src, orig.replace("'Probe v0'", `'Probe v${i}'`));
  const t0 = Date.now();
  const r = await ctx.probe.rebuild();
  const t1 = Date.now();
  srv.send('app', { id: 'probe', entry: r.entry });
  await page
    .getByTestId('label')
    .filter({ hasText: `Probe v${i}` })
    .waitFor();
  await page.waitForFunction((e) => window.__timings.find((t) => t.entry === e)?.paint, r.entry);
  const m = await page.evaluate((e) => window.__timings.find((t) => t.entry === e), r.entry);
  R.loop.push({
    run: i,
    rebuildMs: t1 - t0,
    sendToCommitMs: ms(t1, m.commit),
    sendToPaintMs: ms(t1, m.paint),
    saveToPaintMs: ms(t0, m.paint),
  });
}
await writeFile(src, orig);
R.loopStats = Object.fromEntries(
  ['rebuildMs', 'sendToCommitMs', 'sendToPaintMs', 'saveToPaintMs'].map((k) => [
    k,
    stats(R.loop.map((x) => x[k])),
  ])
);
R.state = await page.evaluate(() => ({
  draftKept: document.querySelector('[data-testid="draft"]').value,
  plainAfter: document.querySelector('[data-testid="plain"]').value,
  mark: window.__mark,
  url: location.pathname + location.search,
  aside: document.querySelector('[data-testid="aside-probe"]').textContent,
}));
await page.screenshot({ path: ev('02-probe-after-10-reloads.png') });

await page.getByRole('button', { name: 'Memory' }).click();
await page.locator('[data-split="tree"]').waitFor();
R.region.memoryAside = await page.getByTestId('aside-memory').textContent();
R.oneReact.hookRefsWithMemory = await page.evaluate(() => window.__hooks.size);
await page.getByRole('separator').focus();
for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
R.split.afterKeys = await page.locator('.pane0').evaluate((e) => e.getBoundingClientRect().width);
await page.screenshot({ path: ev('03-memory-split.png') });

await page.addInitScript(() => {
  window.__cls = 0;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__cls += e.value))).observe({
    type: 'layout-shift',
    buffered: true,
  });
  new MutationObserver((_, o) => {
    const p = document.querySelector('.pane0');
    if (p) ((window.__firstWidth = p.getBoundingClientRect().width), o.disconnect());
  }).observe(document, { childList: true, subtree: true });
});
await page.reload();
await page.locator('[data-split="tree"]').waitFor();
await page.waitForTimeout(500);
R.split.afterReload = await page.evaluate(() => ({
  firstWidth: window.__firstWidth,
  cls: window.__cls,
  cssVar: document.documentElement.style.getPropertyValue('--split-memory-tree'),
}));
await page.screenshot({ path: ev('04-memory-after-reload.png') });

await page.getByRole('button', { name: 'Fat (own React)' }).click();
await page.locator('[data-error-card="fat"]').waitFor();
R.oneReact.fatControl = {
  hookRefs: await page.evaluate(() => window.__hooks.size),
  card: await page.locator('[data-error-card="fat"]').textContent(),
  navStillWorks: await page.getByRole('button', { name: 'Probe' }).isVisible(),
};
await page.screenshot({ path: ev('05-fat-own-react-error-card.png') });
R.oneReact.vendorRequests = vendorReqs;

await browser.close();
srv.close();
for (const c of Object.values(ctx)) await c.dispose();
await writeFile(ev('results.json'), JSON.stringify(R, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      loopStats: R.loopStats,
      state: R.state,
      split: R.split,
      oneReact: R.oneReact,
      region: R.region,
      cold: R.cold,
    },
    null,
    1
  )
);
