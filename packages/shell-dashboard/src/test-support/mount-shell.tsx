import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { ShellApp } from '../shell-app.js';
import { fakeHost } from './fake-host.js';
import { DOC, Fixture, Probe, ProbeTwo, Throws } from './lab-apps.js';

// The shell on the lab daemon for unit tests: start a path, click by text, flush the feeds.
export const mountShell = () => {
  let root: Root | null = null;
  const host = fakeHost(structuredClone(DOC), {
    user: { id: 'u1', email: 'lab@example.test' },
    host: 'local',
  });
  host.modules.set('/app/probe/app-1.js', Probe);
  host.modules.set('/app/probe/app-2.js', ProbeTwo);
  host.modules.set('/app/fixture/app-1.js', Fixture);
  host.modules.set('/app/throws/app-1.js', Throws);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
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
  const click = (text: string, scope: ParentNode = document) =>
    act(async () =>
      [...scope.querySelectorAll<HTMLElement>('button, a, [role="menuitem"]')]
        .find((b) => b.textContent === text)
        ?.click()
    );
  const stop = () => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
  };
  return { host, el, flush, start, click, stop };
};
