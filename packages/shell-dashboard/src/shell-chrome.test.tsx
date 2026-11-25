// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountShell } from './test-support/mount-shell.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let shell = mountShell();
const pill = () => shell.el().querySelector<HTMLElement>('[data-region="notices"] .pill')!;
const inbox = () => shell.el().querySelector('[data-region="aside"] [data-inbox]');
const toasts = () => [...document.querySelectorAll('[data-slot="toast"]')];

beforeEach(() => {
  shell = mountShell();
});
afterEach(() => {
  shell.stop();
  vi.useRealTimers();
});

describe('shell chrome', () => {
  it('a toast leaves after 5 s; the inbox keeps the notice; opening it clears the count', async () => {
    await shell.start('/probe');
    vi.useFakeTimers();
    await shell.click('Notify');
    await shell.click('Fail');
    expect(toasts()).toHaveLength(2);
    expect(pill().textContent).toBe('2');
    await act(async () => vi.advanceTimersByTime(5001));
    expect(toasts()).toHaveLength(0);
    expect(pill().hidden).toBe(false);
    vi.useRealTimers();
    await act(async () =>
      shell.el().querySelector<HTMLButtonElement>('[data-region="notices"] button')?.click()
    );
    expect(location.search).toBe('?inbox=1');
    expect(inbox()?.textContent).toContain('Notified');
    expect(inbox()?.textContent).toContain('Failed');
    expect(inbox()?.querySelectorAll('time')).toHaveLength(2);
    expect(pill().hidden).toBe(true);
  });

  it('a notice that comes while the inbox is open is unread until Mark all read', async () => {
    await shell.start('/probe?inbox=1');
    await shell.click('Notify');
    expect(pill().textContent).toBe('1');
    expect(inbox()?.textContent).toContain('1 unread');
    await shell.click('Mark all read', inbox()!);
    expect(pill().hidden).toBe(true);
    expect(inbox()?.querySelector('.nitem.read')).not.toBeNull();
  });

  it('toast colours come from the components variants by kind', async () => {
    await shell.start('/probe');
    await shell.click('Notify');
    await shell.click('Fail');
    // Error toasts are their own group, above the others.
    const [error, info] = toasts();
    expect(info?.className).toContain('border-info/50');
    expect(error?.className).toContain('border-destructive/50');
    expect(error?.getAttribute('role')).toBe('alert');
  });

  it('an app cannot call another app api through the raw AppContext host', async () => {
    await shell.start('/probe');
    const before = shell.host.calls.length;
    await shell.click('Sneak');
    await shell.flush();
    expect(shell.host.calls.slice(before)).toEqual(['/api/probe/secret']);
    expect(shell.host.apps.at(-1)).toBe('probe');
  });

  it('the open app fills the title page menu and the bottom bar', async () => {
    await shell.start('/probe');
    const ttl = shell.el().querySelector<HTMLButtonElement>('button.ttl')!;
    expect(ttl.textContent).toBe('Probe');
    await act(async () => ttl.click());
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual(['Probe one', 'Runs']);
    expect(items[0]?.getAttribute('aria-current')).toBe('page');
    await shell.click('Runs');
    expect(location.pathname).toBe('/probe/runs');
    const bottom = shell.el().querySelector<HTMLElement>('[data-region="bottom"]')!;
    expect(bottom.hidden).toBe(false);
    expect(bottom.querySelector('.bhead')?.textContent).toBe('Probe log2');
    await shell.click('Fixture');
    expect(shell.el().querySelector('button.ttl')).toBeNull();
    expect(shell.el().querySelector<HTMLElement>('[data-region="bottom"]')!.hidden).toBe(true);
  });

  it('with no extension main is the components empty state', async () => {
    shell.host.state.doc = { ...shell.host.state.doc, extensions: [] };
    await shell.start('/');
    expect(shell.el().querySelector('[data-page="empty"]')?.textContent).toContain('No extensions');
  });
});
