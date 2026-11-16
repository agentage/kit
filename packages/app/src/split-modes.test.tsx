// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Split, type SplitProps } from './split.js';
import { TestHost } from './test-host.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const width = (phone: boolean) =>
  vi.stubGlobal('matchMedia', () => ({
    matches: phone,
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
  return el;
};

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Split on a phone', () => {
  it('one pane shows: the second by default, the first with pane 0, no separator', async () => {
    width(true);
    let el = await mount({});
    expect(el.textContent).toBe('content');
    expect(el.querySelector('[role="separator"]')).toBeNull();
    act(() => root?.unmount());
    el = await mount({ pane: 0 });
    expect(el.textContent).toBe('tree');
  });

  it('on a desktop both panes and the separator show', async () => {
    width(false);
    const el = await mount({ pane: 0 });
    expect(el.textContent).toBe('treecontent');
    expect(el.querySelector('[role="separator"]')).not.toBeNull();
  });
});
