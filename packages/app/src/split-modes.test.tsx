// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Split, type SplitProps } from './split.js';
import { TestHost } from './test-host.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const phoneWidth = (matches: boolean) =>
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
const mount = async (p: Partial<SplitProps>) => {
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <TestHost id="memory">
        <Split id="tree" init={260} min={200} max={420} {...p}>
          <nav>tree</nav>
          <article>content</article>
        </Split>
      </TestHost>
    )
  );
  const split = el.querySelector<HTMLElement>('[data-split="tree"]')!;
  const pane = (n: 0 | 1) => split.querySelector<HTMLElement>(`.pane${n}`)!;
  return { split, pane, sep: split.querySelector<HTMLElement>('[role="separator"]')! };
};

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Split modes', () => {
  it('collapsed hides the first pane and the separator, one column', async () => {
    phoneWidth(false);
    const { split, pane, sep } = await mount({ collapsed: true });
    expect(pane(0).hidden).toBe(true);
    expect(sep.hidden).toBe(true);
    expect(pane(1).hidden).toBe(false);
    expect(split.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
  });

  it('on a phone one pane shows: the second by default, the first with pane 0', async () => {
    phoneWidth(true);
    let s = await mount({});
    expect([s.pane(0).hidden, s.pane(1).hidden]).toEqual([true, false]);
    act(() => root?.unmount());
    s = await mount({ pane: 0 });
    expect([s.pane(0).hidden, s.pane(1).hidden]).toEqual([false, true]);
    expect(s.split.dataset.phone).toBe('0');
  });

  it('on a desktop both panes show', async () => {
    phoneWidth(false);
    const { pane, sep } = await mount({ pane: 0 });
    expect([pane(0).hidden, pane(1).hidden, sep.hidden]).toEqual([false, false, false]);
  });
});
