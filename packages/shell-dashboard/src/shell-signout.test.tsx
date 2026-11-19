// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Discovery, Session } from './host/host.types.js';
import { ShellApp } from './shell-app.js';
import { fakeHost } from './test-support/fake-host.js';
import { DOC } from './test-support/lab-apps.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: 'u1', email: 'lab@example.test', name: 'Alex Doe' };
const CLOUD: Session = { user: USER, host: { kind: 'cloud' }, signOut: '/shell/sign-out' };
let root: Root | null = null;
const flush = () => act(async () => new Promise((done) => setTimeout(done, 0)));
const start = async (session: Session, doc: Discovery = DOC) => {
  const host = fakeHost(structuredClone(doc), session);
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root?.render(<ShellApp deps={host.deps} version="0.1.0" />));
  await flush();
  await act(async () => div.querySelector<HTMLElement>('.acct')?.click());
  return { host, div };
};
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const signOutItems = () => items().filter((m) => m.textContent === 'Sign out');

beforeEach(() => {
  history.replaceState(null, '', '/');
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

describe('Sign out from the session', () => {
  it('a signed-in cloud session with signOut shows one Sign out item', async () => {
    await start(CLOUD);
    expect(signOutItems()).toHaveLength(1);
  });

  it.each([
    ['the daemon (no signOut)', { user: USER, host: { kind: 'local' } }],
    ['no user', { ...CLOUD, user: null }],
    ['a protocol-relative path', { ...CLOUD, signOut: '//evil.test/x' }],
    ['a full URL', { ...CLOUD, signOut: 'https://evil.test/x' }],
    ['a javascript: URL', { ...CLOUD, signOut: 'javascript:alert(1)' }],
  ])('no Sign out item for %s', async (_, session) => {
    await start(session as Session);
    expect(signOutItems()).toHaveLength(0);
  });

  it('a click POSTs the path same-origin, then the session shows signed out', async () => {
    const { host, div } = await start(CLOUD);
    const fetch = vi.spyOn(host.deps, 'fetch');
    host.state.session = { user: null, host: { kind: 'cloud' }, signIn: '/__sign-in?next=%2F' };
    await act(async () => signOutItems()[0]?.click());
    await flush();
    expect(fetch).toHaveBeenCalledWith('/shell/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(fetch).toHaveBeenCalledWith('/shell/session', expect.anything());
    const account = div.querySelector('[data-region="account"]')!;
    expect(account.querySelector('a')?.textContent).toContain('Sign in');
    expect(account.textContent).not.toContain('Alex Doe');
  });

  it('with the account app installed there is still one Sign out row, the session one', async () => {
    const extensions = [...DOC.extensions, { ...DOC.extensions[0]!, id: 'account' }];
    const { host } = await start(CLOUD, { ...DOC, extensions });
    const fetch = vi.spyOn(host.deps, 'fetch');
    expect(signOutItems()).toHaveLength(1);
    await act(async () => signOutItems()[0]?.click());
    expect(fetch).toHaveBeenCalledWith('/shell/sign-out', expect.anything());
  });
});
