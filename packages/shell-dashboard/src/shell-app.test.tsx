// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellApp } from './shell-app.js';
import { fakeHost } from './test-support/fake-host.js';
import { DOC, Fixture, Probe, ProbeTwo, Throws } from './test-support/lab-apps.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | null = null;
let host = fakeHost(DOC);
const el = () => document.getElementById('host')!;
const flush = () => act(async () => new Promise((done) => setTimeout(done, 0)));
const start = async (path: string) => {
  history.replaceState(null, '', path);
  const div = Object.assign(document.createElement('div'), { id: 'host' });
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root?.render(<ShellApp deps={host.deps} version="0.1.0" />));
  await flush();
  await flush();
};
const click = (text: string) =>
  act(async () =>
    [...el().querySelectorAll<HTMLElement>('button, a')]
      .find((b) => b.textContent === text)
      ?.click()
  );
const type = (label: string, value: string) =>
  act(async () => {
    const input = el().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const main = () => el().querySelector('[data-region="main"]')!;

beforeEach(() => {
  host = fakeHost(structuredClone(DOC), {
    user: { id: 'u1', email: 'lab@example.test' },
    host: { kind: 'local' },
  });
  host.modules.set('/app/probe/app-1.js', Probe);
  host.modules.set('/app/probe/app-2.js', ProbeTwo);
  host.modules.set('/app/fixture/app-1.js', Fixture);
  host.modules.set('/app/throws/app-1.js', Throws);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  document.head.querySelectorAll('link[data-app-css]').forEach((l) => l.remove());
});

describe('ShellApp', () => {
  it('lists the app rows by order with their icons, and the signed-in user', async () => {
    await start('/');
    const rows = [...el().querySelectorAll('[data-region="nav"] a.row')];
    expect(rows.map((r) => r.textContent)).toEqual(['Probe', 'Fixture', 'Throws']);
    expect(rows[0]?.querySelector('[data-icon="radar"]')).not.toBeNull();
    expect(el().querySelector('[data-region="account"]')?.textContent).toContain(
      'lab@example.test'
    );
    expect(el().querySelector('[data-region="actions"]')?.textContent).toContain('Home');
    await click('Fixture');
    expect(location.pathname).toBe('/fixture');
    expect(main().querySelector('h1')?.textContent).toBe('Fixture');
  });

  it('signed out on a cloud host: a Sign in link to a safe session signIn; else the hint', async () => {
    const signIn = 'https://auth.agentage.io/sign-in?next=x';
    host = fakeHost(structuredClone(DOC), { user: null, host: { kind: 'cloud' }, signIn });
    await start('/');
    const account = () => el().querySelector('[data-region="account"]')!;
    expect(account().querySelector('a')?.getAttribute('href')).toBe(signIn);
    act(() => root?.unmount());
    document.body.innerHTML = '';
    host = fakeHost(structuredClone(DOC), {
      user: null,
      host: { kind: 'local' },
      signIn: '/shell/sign-in',
    });
    await start('/');
    expect(account().querySelector('a.acct.signin')?.getAttribute('href')).toBe('/shell/sign-in');
    for (const session of [{ signIn: 'javascript:alert(1)' }, {}]) {
      act(() => root?.unmount());
      document.body.innerHTML = '';
      host = fakeHost(structuredClone(DOC), { user: null, host: { kind: 'local' }, ...session });
      await start('/');
      expect(account().querySelector('a')).toBeNull();
      expect(account().textContent).toContain('run agentage setup');
    }
  });

  it('mounts the app with its css; api, notify and the details aside work', async () => {
    await start('/probe');
    expect(main().textContent).toContain('Probe one');
    expect(main().textContent).toContain('At /?');
    expect(main().textContent).toContain('User lab@example.test');
    expect(document.head.querySelector('link[data-app-css="probe"]')?.getAttribute('href')).toBe(
      '/app/probe/app-1.css'
    );
    await click('Fixture');
    expect(document.head.querySelector('link[data-app-css="probe"]')).toBeNull();
    expect(document.head.querySelectorAll('link[data-app-css]')).toHaveLength(1);
    await click('Probe');
    await flush();
    await click('Ping');
    await flush();
    expect(main().querySelector('output')?.textContent).toBe('/api/probe/echo');
    await click('Notify');
    expect(document.querySelector('[data-slot="toast"]')?.textContent).toContain('Notified');
    expect(el().querySelector('[data-region="notices"] .pill')?.textContent).toBe('1');
    await click('Details');
    expect(location.search).toBe('?details=1');
    expect(main().textContent).toContain('At /?details=1');
    const aside = el().querySelector('[data-region="aside"]')!;
    expect(aside.textContent).toContain('probe details');
    expect(el().querySelector('.app')?.classList.contains('aside-open')).toBe(true);
    await act(async () =>
      aside.querySelector<HTMLButtonElement>('[aria-label="Close aside"]')?.click()
    );
    expect(location.search).toBe('');
  });

  it('a throwing app gives an error card, the nav still works', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start('/throws');
    expect(main().querySelector('[role="alert"]')?.textContent).toContain('lab app throws');
    await click('Probe');
    expect(main().textContent).toContain('Probe one');
    vi.restoreAllMocks();
  });

  it('an import error is a card; an unknown page says not found', async () => {
    host.modules.delete('/app/fixture/app-1.js');
    await start('/fixture');
    expect(main().querySelector('[role="alert"]')?.textContent).toContain('no module');
    act(() => root?.unmount());
    document.body.innerHTML = '';
    await start('/nope/x');
    expect(main().textContent).toContain('Not found');
    expect(main().textContent).toContain('/nope/x');
  });

  it('an app event remounts the root with the new build and keeps state(key)', async () => {
    await start('/probe');
    await type('Draft', 'abc');
    await type('Plain', 'lost');
    await act(async () =>
      host.emit('app', { id: 'probe', entry: '/app/probe/app-2.js', css: '/app/probe/app-2.css' })
    );
    await flush();
    expect(main().querySelector('h1')?.textContent).toBe('Probe two abc');
    expect(document.head.querySelector('link[data-app-css="probe"]')?.getAttribute('href')).toBe(
      '/app/probe/app-2.css'
    );
  });

  it('two apps keep their own state across navigation and back', async () => {
    await start('/probe');
    await type('Draft', 'kept');
    await click('Fixture');
    expect(main().querySelector('h1')?.textContent).toBe('Fixture');
    await act(async () => {
      history.back();
      await new Promise((done) => setTimeout(done, 20));
    });
    await flush();
    expect(location.pathname).toBe('/probe');
    expect(el().querySelector<HTMLInputElement>('input[aria-label="Draft"]')?.value).toBe('kept');
  });

  it('remove: the row leaves and the open page says the app was removed', async () => {
    await start('/fixture');
    host.state.doc = { ...DOC, extensions: DOC.extensions.filter((x) => x.id !== 'fixture') };
    await act(async () => host.emit('extensions', { op: 'remove', id: 'fixture' }));
    await flush();
    expect([...el().querySelectorAll('a.row')].map((r) => r.textContent)).not.toContain('Fixture');
    expect(main().textContent).toContain('Fixture was removed');
  });

  it('a session event reloads the user; the inbox lists notices in the aside', async () => {
    await start('/probe');
    host.state.session = {
      user: { id: 'u1', email: 'e@x.test', name: 'Alex Doe' },
      host: { kind: 'local' },
    };
    await act(async () => host.emit('session'));
    await flush();
    expect(el().querySelector('[data-region="account"]')?.textContent).toContain('Alex Doe');
    await click('Notify');
    await act(async () =>
      el().querySelector<HTMLButtonElement>('[data-region="notices"] button')?.click()
    );
    expect(location.search).toBe('?inbox=1');
    expect(el().querySelector('[data-region="aside"]')?.getAttribute('data-aside-key')).toBe(
      'inbox'
    );
    expect(el().querySelector('[data-region="aside"] [data-inbox]')?.textContent).toContain(
      'Notified'
    );
  });

  it('a reconnected feed fetches discovery and session again', async () => {
    await start('/');
    const before = host.calls.length;
    await act(async () => host.emit('open'));
    await flush();
    expect(host.calls.slice(before).sort()).toEqual([
      '/.well-known/agentage-host.json',
      '/shell/session',
    ]);
  });
});
