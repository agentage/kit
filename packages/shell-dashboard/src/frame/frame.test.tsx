// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Frame, type FrameProps } from './frame.js';
import { createRegionHost } from './regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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
  return { el, props, regions };
};
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('Frame', () => {
  it('renders the prototype regions and registers the app regions', async () => {
    const { el, regions } = await mount();
    for (const r of [
      'mobile-header',
      'nav',
      'notices',
      'account',
      'main',
      'actions',
      'aside',
      'bottom',
      'side',
    ])
      expect(el.querySelector(`[data-region="${r}"]`), r).not.toBeNull();
    for (const r of ['actions', 'aside', 'notices', 'bottom', 'side'] as const)
      expect(regions.node(r), r).not.toBeNull();
    expect(el.querySelector('[data-region="account"]')?.textContent).toContain('shell 0.1.0');
    expect(el.querySelector('[aria-current="page"]')?.textContent).toBe('Probe');
  });

  it('a nav row navigates without a page load', async () => {
    const { el, props } = await mount();
    await act(async () => el.querySelector<HTMLAnchorElement>('a[href="/fixture"]')?.click());
    expect(props.onNavigate).toHaveBeenCalledWith('/fixture');
  });

  it('hides and docks the nav, kept in storage and on <html>', async () => {
    const { el } = await mount();
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]')?.click()
    );
    expect(document.documentElement.classList.contains('nh')).toBe(true);
    expect(localStorage.getItem('ag.navh')).toBe('1');
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Show sidebar"]')?.click()
    );
    expect(document.documentElement.classList.contains('nh')).toBe(false);
  });

  it('on a phone the menu button opens the drawer and Escape closes it', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { el } = await mount();
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')?.click()
    );
    expect(document.body.classList.contains('drawer')).toBe(true);
    await press('Escape');
    expect(document.body.classList.contains('drawer')).toBe(false);
  });

  it('Ctrl+K opens the command list with one line per app and toggle sidebar', async () => {
    const { props } = await mount();
    await press('k', { ctrlKey: true });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Command list');
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(['Go to Probe', 'Go to Fixture', 'Toggle sidebar']);
    await act(async () =>
      document.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]?.click()
    );
    expect(props.onNavigate).toHaveBeenCalledWith('/fixture');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('the nav splitter moves 16 px per arrow and stores the width', async () => {
    const { el } = await mount();
    const sep = el.querySelector<HTMLElement>('[aria-label="Resize sidebar"]')!;
    expect(sep.getAttribute('aria-valuenow')).toBe('280');
    await press('ArrowLeft', {}, sep);
    expect(sep.getAttribute('aria-valuenow')).toBe('264');
    expect(localStorage.getItem('ag.nav')).toBe('264');
    expect(document.documentElement.style.getPropertyValue('--nav-full')).toBe('264px');
    await press('End', {}, sep);
    expect(sep.getAttribute('aria-valuenow')).toBe('420');
    await press('Home', {}, sep);
    expect(sep.getAttribute('aria-valuenow')).toBe('232');
    await press('a', {}, sep);
    expect(sep.getAttribute('aria-valuenow')).toBe('232');
  });

  it('the aside splitter grows to the left; drag follows the pointer', async () => {
    const onClose = vi.fn();
    const { el } = await mount({ aside: { title: 'Details', onClose } });
    expect(el.querySelector('.app')?.classList.contains('aside-open')).toBe(true);
    const sep = el.querySelector<HTMLElement>('[aria-label="Resize aside"]')!;
    await press('ArrowLeft', { shiftKey: true }, sep);
    expect(sep.getAttribute('aria-valuenow')).toBe('424');
    await act(async () => {
      sep.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 900 }));
      sep.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 880 }));
      sep.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(sep.getAttribute('aria-valuenow')).toBe('444');
    expect(localStorage.getItem('ag.aside')).toBe('444');
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Expand aside"]')?.click()
    );
    expect(el.querySelector('.app')?.classList.contains('aside-wide')).toBe(true);
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Close aside"]')?.click()
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('the bottom region shows only with a title and opens with its header', async () => {
    const { el } = await mount({ bottom: 'Log tail' });
    const bottom = el.querySelector<HTMLElement>('[data-region="bottom"]')!;
    expect(bottom.hidden).toBe(false);
    await act(async () => bottom.querySelector<HTMLButtonElement>('.bhead')?.click());
    expect(document.documentElement.classList.contains('bo')).toBe(true);
    const sep = bottom.querySelector<HTMLElement>('[role="separator"]')!;
    await press('ArrowUp', {}, sep);
    expect(sep.getAttribute('aria-valuenow')).toBe('236');
  });

  it('signed out, the account names the setup command', async () => {
    const { el } = await mount({ account: { label: null, initials: '?' } });
    expect(el.querySelector('.acct')?.getAttribute('title')).toBe(
      'Not signed in, run agentage setup'
    );
  });
});
