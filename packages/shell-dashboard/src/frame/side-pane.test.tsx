// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createRegionHost } from './regions.js';
import { SidePane } from './side-pane.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
});

const mount = async () => {
  const regions = createRegionHost();
  const el = document.body.appendChild(document.createElement('div'));
  root = createRoot(el);
  await act(async () => root?.render(<SidePane regionRef={regions.ref} />));
  return { pane: el.querySelector<HTMLElement>('[data-region="side"]')!, regions };
};

describe('side pane', () => {
  it('is hidden until an app puts content in it, hidden again when it leaves', async () => {
    const { pane, regions } = await mount();
    expect(pane.hidden).toBe(true);
    const node = regions.node('side')!;
    const tree = document.createElement('ul');
    await act(async () => void node.append(tree));
    expect(pane.hidden).toBe(false);
    await act(async () => void tree.remove());
    expect(pane.hidden).toBe(true);
  });

  it('has a splitter: 260 px, 200 to 420, kept in ag.side', async () => {
    const { pane } = await mount();
    const sep = pane.querySelector('[role="separator"]')!;
    expect(sep.getAttribute('aria-label')).toBe('Resize side pane');
    expect([sep.getAttribute('aria-valuenow'), sep.getAttribute('aria-valuemin')]).toEqual([
      '260',
      '200',
    ]);
    expect(sep.getAttribute('aria-valuemax')).toBe('420');
    await act(async () =>
      sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    );
    expect(localStorage.getItem('ag.side')).toBe('276');
    expect(document.documentElement.style.getPropertyValue('--side-w')).toBe('276px');
  });
});
