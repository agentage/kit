// K2 side check: the same frame with plain frame.css (A), Tailwind v4 + frame.css (TW), and TW + design system (TW-DS).
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { chromium } from 'playwright';
import { appContext, buildShell, buildVendor, clean, out } from './build.mjs';
import { startServer } from './server.mjs';

const here = new URL('.', import.meta.url).pathname;
const R = { css: {}, diff: {}, dsApp: {} };
const time = async (fn) => {
  const t = performance.now();
  const r = await fn();
  return [Math.round(performance.now() - t), r];
};

await clean();
await buildVendor();
await buildShell();
await copyFile(join(here, 'src/shell/frame.css'), join(here, 'tw/frame.css'));
const compile = async (name) => {
  const from = join(here, `tw/${name}.css`);
  const [ms, res] = await time(() =>
    postcss([tailwind({ base: here, optimize: { minify: true } })]).process(files[from], { from })
  );
  return { ms, css: res.css };
};
const files = {};
for (const v of ['a', 'tw', 'tw-ds'])
  files[join(here, `tw/${v}.css`)] = await readFile(join(here, `tw/${v}.css`), 'utf8');
const variants = {};
for (const v of ['a', 'tw', 'tw-ds']) {
  const { ms, css } = await compile(v);
  variants[v] = css;
  R.css[v] = { ms, bytes: css.length, hasAppOnlyClass: css.includes('.text-amber-300') };
}

const entries = {};
const ctx = {};
for (const id of ['probe', 'memory', 'ds']) {
  ctx[id] = await appContext(id);
  const [ms, r] = await time(ctx[id].rebuild);
  entries[id] = r.entry;
  if (id === 'ds') Object.assign(R.dsApp, { coldMs: ms, bytes: r.bytes });
}
const src = join(here, 'apps/ds/index.tsx');
const orig = await readFile(src, 'utf8');
const warm = [];
for (let i = 1; i <= 10; i++) {
  await writeFile(src, orig.replace("'DS v0'", `'DS v${i}'`));
  warm.push((await time(ctx.ds.rebuild))[0]);
}
await writeFile(src, orig);
R.dsApp.warmMs = warm;

const rows = [
  { id: 'probe', title: 'Probe' },
  { id: 'memory', title: 'Memory' },
].map((r) => ({ ...r, entry: entries[r.id] }));
const srv = await startServer(rows);
const browser = await chromium.launch();
const shots = {};
for (const v of ['a', 'tw', 'tw-ds']) {
  await writeFile(join(out, 'shell/frame.css'), variants[v]);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${srv.port}/memory?details=1`);
  await page.locator('[data-split="tree"]').waitFor();
  await page.waitForTimeout(300);
  shots[v] = await page.screenshot({ path: join(here, `evidence/06-frame-${v}.png`) });
  await page.close();
}
const cmp = await browser.newPage();
for (const v of ['tw', 'tw-ds']) {
  R.diff[v] = await cmp.evaluate(
    async ([a, b]) => {
      const load = async (s) => {
        const i = new Image();
        i.src = `data:image/png;base64,${s}`;
        await i.decode();
        const c = new OffscreenCanvas(i.width, i.height);
        const x = c.getContext('2d');
        x.drawImage(i, 0, 0);
        return x.getImageData(0, 0, i.width, i.height).data;
      };
      const [p, q] = [await load(a), await load(b)];
      let n = 0;
      for (let k = 0; k < p.length; k += 4)
        if (
          Math.abs(p[k] - q[k]) + Math.abs(p[k + 1] - q[k + 1]) + Math.abs(p[k + 2] - q[k + 2]) >
          24
        )
          n++;
      return { diffPixels: n, percent: Math.round((n / (p.length / 4)) * 10000) / 100 };
    },
    [shots.a.toString('base64'), shots[v].toString('base64')]
  );
}
await browser.close();
srv.close();
for (const c of Object.values(ctx)) await c.dispose();
await writeFile(join(here, 'evidence/tw-results.json'), JSON.stringify(R, null, 2) + '\n');
console.log(JSON.stringify(R, null, 1));
