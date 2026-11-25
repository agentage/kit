// @vitest-environment jsdom
import {
  resizableSplitCollapsedVar,
  resizableSplitVar,
} from '@agentage/components/resizable-split';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Split, SPLIT_PREPAINT, splitKey, splitVar, useSplit, type SplitProps } from './split.js';
import { TestHost } from './test-host.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const Toggle = () => <button onClick={useSplit().toggle}>toggle</button>;
const mount = async (p: Partial<SplitProps> = {}) => {
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <TestHost id="memory">
        <Split id="tree" init={260} min={200} max={420} label="Resize tree" {...p}>
          <nav>
            tree <Toggle />
          </nav>
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
const html = () => document.documentElement.style;
const KEY = splitKey('memory', 'tree');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

describe('Split (components ResizableSplit)', () => {
  it('keeps the ag.split.{app}.{id} key; the variable names are the components ones', () => {
    expect(KEY).toBe('ag.split.memory.tree');
    expect(splitVar('memory', 'tree')).toBe(resizableSplitVar(KEY));
  });

  it('steps 16 px with the arrows, 64 with Shift, kept in storage', async () => {
    const sep = await mount();
    expect(sep.getAttribute('aria-valuenow')).toBe('260');
    await key(sep, 'ArrowLeft');
    expect(sep.getAttribute('aria-valuenow')).toBe('244');
    expect(localStorage.getItem(KEY)).toBe('244');
    expect(html().getPropertyValue(resizableSplitVar(KEY))).toBe('244px');
    await key(sep, 'ArrowRight', true);
    expect(sep.getAttribute('aria-valuenow')).toBe('308');
  });

  it('clamps at min and max (Home, End, arrows past the edge)', async () => {
    const sep = await mount();
    await key(sep, 'Home');
    await key(sep, 'ArrowLeft');
    expect(sep.getAttribute('aria-valuenow')).toBe('200');
    await key(sep, 'End');
    expect(sep.getAttribute('aria-valuenow')).toBe('420');
  });

  it('the pre-paint script sets the size and the collapsed flag of every ag.split key', () => {
    localStorage.setItem(KEY, '380');
    localStorage.setItem(`${KEY}.collapsed`, '1');
    localStorage.setItem('ag.split.logs.filters', '300');
    localStorage.setItem('unrelated', '5');
    new Function(SPLIT_PREPAINT)();
    expect(html().getPropertyValue(resizableSplitVar(KEY))).toBe('380px');
    expect(html().getPropertyValue(resizableSplitCollapsedVar(KEY))).toBe('0px');
    expect(html().getPropertyValue(splitVar('logs', 'filters'))).toBe('300px');
    expect(html().getPropertyValue(resizableSplitCollapsedVar('ag.split.logs.filters'))).toBe('');
  });

  it('collapsible: useSplit().toggle hides the sized pane and stores it', async () => {
    await mount({ collapsible: true });
    const split = document.querySelector<HTMLElement>('[data-split="tree"]')!;
    await act(async () => document.querySelector('button')?.click());
    expect(split.dataset.collapsed).toBe('true');
    expect(localStorage.getItem(`${KEY}.collapsed`)).toBe('1');
  });
});
