// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Frame, type FrameProps } from './frame.js';
import type { PageItem } from './frame.types.js';
import { createRegionHost } from './regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const PAGES: PageItem[] = [
  { title: 'All memories', href: '/probe', current: false },
  { title: 'demo', href: '/probe/demo', current: true },
];
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
    pages: PAGES,
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
const subs = (el: Element) => [...el.querySelectorAll<HTMLAnchorElement>('nav .row.subrow')];

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

describe('nav pages', () => {
  it('lists the pages right after the open app row only, in a named group', async () => {
    const { el } = await mount();
    const group = el.querySelector('nav [role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Probe pages');
    expect(group.previousElementSibling?.textContent).toBe('Probe');
    expect(group.nextElementSibling?.textContent).toBe('Fixture');
    expect(el.querySelectorAll('nav [role="group"]')).toHaveLength(1);
    expect(subs(el).map((a) => [a.textContent, a.getAttribute('title')])).toEqual([
      ['All memories', 'All memories'],
      ['demo', 'demo'],
    ]);
  });

  it('marks the current page with aria-current', async () => {
    const { el } = await mount();
    expect(subs(el).map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page']);
  });

  it('shows no sub-rows for no page or one page', async () => {
    const none = await mount({ pages: [] });
    expect(subs(none.el)).toHaveLength(0);
    act(() => root?.unmount());
    const one = await mount({ pages: [PAGES[0]!] });
    expect(subs(one.el)).toHaveLength(0);
  });

  it('shows no sub-rows when no app is open', async () => {
    const { el } = await mount({
      rows: [{ id: 'probe', title: 'Probe', href: '/probe', icon: null }],
    });
    expect(subs(el)).toHaveLength(0);
  });

  it('a plain click navigates through the shell, a modified click is left to the browser', async () => {
    const { el, props } = await mount();
    const link = subs(el)[0]!;
    const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => void link.dispatchEvent(ctrl));
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(ctrl.defaultPrevented).toBe(false);
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => void link.dispatchEvent(plain));
    expect(props.onNavigate).toHaveBeenCalledWith('/probe');
    expect(plain.defaultPrevented).toBe(true);
    expect(link.getAttribute('href')).toBe('/probe');
  });
});
