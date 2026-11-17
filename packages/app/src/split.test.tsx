// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Split, SPLIT_PREPAINT, splitKey, splitVar } from './split.js';
import { TestHost } from './test-host.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = async () => {
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <TestHost id="memory">
        <Split id="tree" init={260} min={200} max={420} label="Resize tree">
          <nav>tree</nav>
          <article>content</article>
        </Split>
      </TestHost>
    )
  );
  return el.querySelector<HTMLElement>('[role="separator"]')!;
};
const key = (sep: HTMLElement, k: string, shiftKey = false) =>
  act(async () => {
    sep.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
  });
const root0 = () => document.documentElement.style;

beforeEach(() => {
  localStorage.clear();
  root0().removeProperty(splitVar('memory', 'tree'));
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

describe('Split', () => {
  it('starts at init and steps 16 px with the arrow keys, kept in storage', async () => {
    const sep = await mount();
    expect(sep.getAttribute('aria-valuenow')).toBe('260');
    await key(sep, 'ArrowLeft');
    expect(sep.getAttribute('aria-valuenow')).toBe('244');
    expect(localStorage.getItem(splitKey('memory', 'tree'))).toBe('244');
    expect(root0().getPropertyValue('--split-memory-tree')).toBe('244px');
    await key(sep, 'ArrowRight', true);
    expect(sep.getAttribute('aria-valuenow')).toBe('308');
  });

  it('clamps at min and max (Home, End, arrows past the edge)', async () => {
    const sep = await mount();
    await key(sep, 'Home');
    expect(sep.getAttribute('aria-valuenow')).toBe('200');
    await key(sep, 'ArrowLeft');
    expect(sep.getAttribute('aria-valuenow')).toBe('200');
    await key(sep, 'End');
    expect(sep.getAttribute('aria-valuenow')).toBe('420');
    await key(sep, 'Tab');
    expect(sep.getAttribute('aria-valuenow')).toBe('420');
  });

  it('the pre-paint script restores a stored size before React, clamped by the split', async () => {
    localStorage.setItem(splitKey('memory', 'tree'), '9999');
    localStorage.setItem('ag.split.memory.other', '300');
    localStorage.setItem('unrelated', '5');
    new Function(SPLIT_PREPAINT)();
    expect(root0().getPropertyValue('--split-memory-other')).toBe('300px');
    expect(root0().getPropertyValue('--split-memory-tree')).toBe('');
    localStorage.setItem(splitKey('memory', 'tree'), '380');
    new Function(SPLIT_PREPAINT)();
    const sep = await mount();
    expect(sep.getAttribute('aria-valuenow')).toBe('380');
    const grid = sep.closest<HTMLElement>('[data-split="tree"]')!.style.gridTemplateColumns;
    expect(grid).toContain('clamp(200px, var(--split-memory-tree, 260px), 420px)');
  });

  it('follows a pointer drag', async () => {
    const sep = await mount();
    const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 260 });
    const move = new MouseEvent('pointermove', { bubbles: true, clientX: 333 });
    await act(async () => {
      sep.dispatchEvent(down);
      sep.dispatchEvent(move);
      sep.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      sep.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 400 }));
    });
    expect(sep.getAttribute('aria-valuenow')).toBe('333');
  });
});
