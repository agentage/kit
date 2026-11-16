// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Frame, type FrameProps } from './frame.js';
import { createRegionHost } from './regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = async (over: Partial<FrameProps> = {}) => {
  const props: FrameProps = {
    rows: [{ id: 'memory', title: 'Memory', href: '/memory', icon: null, current: true }],
    account: { label: 'Alex Doe', initials: 'AD' },
    version: '0.1.0',
    title: 'Memory',
    aside: null,
    regionRef: createRegionHost().ref,
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
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
const click = (el: Element | null | undefined) =>
  act(async () => (el as HTMLElement | null)?.click());
const menuItems = () =>
  [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

describe('Frame slots', () => {
  it('the title is plain text with no pages; with pages it opens a page menu', async () => {
    const { el } = await mount();
    expect(el.querySelector('span.ttl')?.textContent).toBe('Memory');
    act(() => root?.unmount());
    const pages = [
      { title: 'Files', href: '/memory', current: true },
      { title: 'Activity', href: '/memory/activity' },
    ];
    const m = await mount({ pages });
    const ttl = m.el.querySelector<HTMLButtonElement>('button.ttl')!;
    expect(ttl.getAttribute('aria-expanded')).toBe('false');
    await click(ttl);
    expect(ttl.getAttribute('aria-expanded')).toBe('true');
    expect(menuItems()).toEqual(['Files', 'Activity']);
    await click(document.querySelectorAll('[role="menuitem"]')[1]);
    expect(m.props.onNavigate).toHaveBeenCalledWith('/memory/activity');
  });

  it('the lead slot sits left of the title in the actions bar', async () => {
    const { el } = await mount();
    const lgrp = el.querySelector('.abar .lgrp')!;
    expect(lgrp.firstElementChild?.getAttribute('data-region')).toBe('lead');
  });

  it('Escape closes the aside, but not while a menu is open', async () => {
    const onClose = vi.fn();
    const { el } = await mount({
      aside: { title: 'Details', onClose },
      pages: [{ title: 'Files', href: '/memory' }],
    });
    await click(el.querySelector('button.ttl'));
    await press('Escape', {}, document.querySelector('[role="menu"]')!);
    expect(onClose).not.toHaveBeenCalled();
    await press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the account menu lists Settings, Tokens, Sign out only when the routes exist', async () => {
    const { el } = await mount();
    await click(el.querySelector('.acct'));
    expect(menuItems()).toEqual(['Command list', 'Toggle sidebar']);
    act(() => root?.unmount());
    const links = { settings: '/account/settings', signOut: '/account/sign-out' };
    const m = await mount({ account: { label: 'Alex Doe', initials: 'AD', links } });
    await click(m.el.querySelector('.acct'));
    expect(menuItems()).toEqual(['Command list', 'Toggle sidebar', 'Settings', 'Sign out']);
    await click([...document.querySelectorAll('[role="menuitem"]')].at(-1));
    expect(m.props.onNavigate).toHaveBeenCalledWith('/account/sign-out');
  });

  it('the mobile avatar is a button that opens the account menu', async () => {
    const { el } = await mount();
    const av = el.querySelector<HTMLButtonElement>('[data-region="mobile-header"] button.av')!;
    expect(av.getAttribute('aria-label')).toBe('Account menu');
    await click(av);
    expect(menuItems()).toContain('Command list');
  });

  it('the command list adds Open inbox, Toggle bottom panel and Toggle details', async () => {
    const onDetails = vi.fn();
    await mount({ onInbox: vi.fn(), onDetails, bottom: { title: 'Activity' } });
    await press('k', { ctrlKey: true });
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual([
      'Go to Memory',
      'Open inbox',
      'Toggle sidebar',
      'Toggle bottom panel',
      'Toggle details',
    ]);
    await click(document.querySelectorAll('[role="option"]')[4]);
    expect(onDetails).toHaveBeenCalled();
  });

  it('the hidden nav peeks while the pointer is on the show button', async () => {
    localStorage.setItem('ag.navh', '1');
    document.documentElement.classList.add('nh');
    const { el } = await mount();
    const nav = el.querySelector('nav.side')!;
    const show = el.querySelector('#show')!;
    await act(async () => {
      show.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    expect(nav.classList.contains('peek')).toBe(true);
  });
});
