// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Frame, type FrameProps } from './frame.js';
import type { NavSectionView } from './frame.types.js';
import { createRegionHost } from './regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const SECTION: NavSectionView = {
  title: 'Memories',
  items: [
    { title: 'personal', href: '/probe/personal', current: false, icon: <i data-ic="a" /> },
    { title: 'work', href: '/probe/work', current: true, icon: <i data-ic="b" /> },
  ],
};
let root: Root | null = null;
const mount = async (over: Partial<FrameProps> = {}) => {
  const regions = createRegionHost();
  const props: FrameProps = {
    rows: [
      { id: 'probe', title: 'Probe', href: '/probe', icon: null, current: true },
      { id: 'fixture', title: 'Fixture', href: '/fixture', icon: null },
    ],
    account: { label: 'Alex Doe', initials: 'AD' },
    version: '0.1.0',
    title: 'Probe',
    section: SECTION,
    aside: null,
    regionRef: regions.ref,
    onNavigate: vi.fn(),
    children: <p>app</p>,
    ...over,
  };
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root?.render(<Frame {...props} />));
  return { el, props };
};
const items = (el: Element) => [...el.querySelectorAll<HTMLAnchorElement>('nav .navsect .row')];

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

describe('nav section', () => {
  it('shows the title and the items after the app rows, in a labelled group', async () => {
    const { el } = await mount();
    const group = el.querySelector('nav [role="group"]')!;
    const label = group.querySelector('.sect')!;
    expect(label.textContent).toBe('Memories');
    expect(group.getAttribute('aria-labelledby')).toBe(label.id);
    expect(group.previousElementSibling?.textContent).toBe('Fixture');
    expect(items(el).map((a) => [a.textContent, a.getAttribute('title')])).toEqual([
      ['personal', 'personal'],
      ['work', 'work'],
    ]);
    expect(items(el)[0]?.querySelector('[data-ic="a"]')).not.toBeNull();
  });

  it('marks the current item with aria-current', async () => {
    const { el } = await mount();
    expect(items(el).map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page']);
  });

  it('shows no section when the app gives none', async () => {
    const { el } = await mount({ section: null });
    expect(el.querySelector('nav .navsect')).toBeNull();
    expect(el.querySelector('nav [role="group"]')).toBeNull();
  });

  it('a plain click navigates through the shell, a modified click is left to the browser', async () => {
    const { el, props } = await mount();
    const link = items(el)[0]!;
    const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => void link.dispatchEvent(ctrl));
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(ctrl.defaultPrevented).toBe(false);
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => void link.dispatchEvent(plain));
    expect(props.onNavigate).toHaveBeenCalledWith('/probe/personal');
    expect(plain.defaultPrevented).toBe(true);
    expect(link.getAttribute('href')).toBe('/probe/personal');
  });
});
