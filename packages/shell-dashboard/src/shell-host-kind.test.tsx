// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from './host/host.types.js';
import { ShellApp } from './shell-app.js';
import { fakeHost } from './test-support/fake-host.js';
import { DOC, Probe } from './test-support/lab-apps.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const flush = () => act(async () => new Promise((done) => setTimeout(done, 0)));
const main = () => document.querySelector('[data-region="main"]')!;

// The probe app on /probe, with the session the host answers (null: /shell/session fails).
const start = async (session: Session | null) => {
  const host = fakeHost(structuredClone(DOC), session ?? undefined);
  host.modules.set('/app/probe/app-1.js', Probe);
  const fetchImpl = host.deps.fetch;
  const down = { session: session === null };
  const deps = {
    ...host.deps,
    fetch: (async (input, init) =>
      down.session && String(input) === '/shell/session'
        ? new Response('down', { status: 503 })
        : fetchImpl(input, init)) as typeof fetch,
  };
  history.replaceState(null, '', '/probe');
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root?.render(<ShellApp deps={deps} version="0.1.0" />));
  await flush();
  await flush();
  return { host, down };
};

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

describe('the app adapter follows the session host kind', () => {
  it('kind cloud mounts the app', async () => {
    await start({ user: null, host: { kind: 'cloud' } });
    expect(main().querySelector('[data-app="probe"]')).not.toBeNull();
    expect(main().querySelector('[role="alert"]')).toBeNull();
  });

  it('a failed session read is a card, not a local adapter', async () => {
    await start(null);
    expect(main().querySelector('[data-app="probe"]')).toBeNull();
    expect(main().querySelector('[role="alert"]')?.textContent).toContain(
      'the host session could not be read'
    );
  });

  it('a failed re-read keeps the last good session: the app stays mounted', async () => {
    const { host, down } = await start({ user: { id: 'u1' }, host: { kind: 'cloud' } });
    const app = main().querySelector('[data-app="probe"]');
    down.session = true;
    await act(async () => host.emit('session'));
    await flush();
    expect(main().querySelector('[data-app="probe"]')).toBe(app);
    expect(main().querySelector('[role="alert"]')).toBeNull();
  });

  it('an unknown kind is a card that names it', async () => {
    await start({ user: null, host: { kind: 'mainframe' } });
    expect(main().querySelector('[data-app="probe"]')).toBeNull();
    expect(main().querySelector('[role="alert"]')?.textContent).toContain(
      'no adapter for the host kind mainframe'
    );
  });
});
