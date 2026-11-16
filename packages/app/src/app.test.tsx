// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppBoundary,
  createStateStore,
  Region,
  useAppHost,
  useAppShell,
  useAppState,
} from './index.js';
import { createTestRecord, TestHost } from './test-host.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | null = null;
const mount = async (node: React.ReactNode) => {
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root?.render(node));
  return el;
};
const flush = () => act(async () => new Promise((done) => setTimeout(done, 0)));
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

const Details = () => {
  const [draft] = useAppState('draft', '');
  const { user } = useAppHost();
  return <p data-testid="details">{`${user?.name ?? '-'}: ${draft}`}</p>;
};

// A sample app as the sheet describes probe: Ping, Notify, Details, the user, state('draft').
const Sample = () => {
  const [draft, setDraft] = useAppState('draft', '');
  const [pong, setPong] = useState('');
  const shell = useAppShell();
  const host = useAppHost();
  return (
    <div>
      <h1>{shell.id}</h1>
      <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button
        onClick={() => void host.api<{ path: string }>('/echo?msg=hi').then((d) => setPong(d.path))}
      >
        Ping
      </button>
      <output>{pong}</output>
      <button onClick={() => shell.notify({ text: 'hi', kind: 'ok' })}>Notify</button>
      <button onClick={() => shell.openAside('details')}>Details</button>
      <Region name="aside">
        <Details />
      </Region>
      <Region name="actions">
        <span data-testid="title">Probe</span>
      </Region>
    </div>
  );
};

const click = (el: Element, name: string) =>
  act(async () => {
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent === name);
    button?.click();
  });

describe('an app in the test host', () => {
  it('renders into regions, calls its api, notifies and opens the aside', async () => {
    const record = createTestRecord();
    const el = await mount(
      <TestHost id="probe" record={record}>
        <Sample />
      </TestHost>
    );
    await flush();
    expect(el.querySelector('[data-region="actions"] [data-testid="title"]')?.textContent).toBe(
      'Probe'
    );
    expect(el.querySelector('[data-region="aside"]')?.textContent).toBe('Test User: ');
    await click(el, 'Ping');
    await flush();
    expect(el.querySelector('output')?.textContent).toBe('/echo?msg=hi');
    expect(record.calls[0]).toMatchObject({ id: 'probe', path: '/echo?msg=hi', method: 'GET' });
    expect(record.calls[0]?.headers['x-agentage-app']).toBe('probe');
    await click(el, 'Notify');
    await click(el, 'Details');
    expect(record.notices).toEqual([{ text: 'hi', kind: 'ok' }]);
    expect(record.aside).toBe('details');
  });

  it('keeps state(key) across a remount and shares it with a Region', async () => {
    const store = createStateStore();
    const el = await mount(
      <TestHost id="probe" store={store}>
        <Sample />
      </TestHost>
    );
    await flush();
    await act(async () => store.set('probe:draft', 'abc'));
    expect(el.querySelector('input')?.value).toBe('abc');
    expect(el.querySelector('[data-testid="details"]')?.textContent).toBe('Test User: abc');
    await act(async () =>
      root?.render(
        <TestHost id="probe" store={store}>
          <Sample key="v2" />
        </TestHost>
      )
    );
    await flush();
    expect(el.querySelector('input')?.value).toBe('abc');
    expect(store.has('fixture:draft')).toBe(false);
  });

  it('a hook outside the shell names the problem', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Bare = () => <span>{useAppShell().id}</span>;
    const el = await mount(
      <AppBoundary name="bare">
        <Bare />
      </AppBoundary>
    );
    expect(el.querySelector('[data-error-card="bare"]')?.textContent).toContain(
      'outside the shell'
    );
    spy.mockRestore();
  });

  it('a broken Region shows a card and the main tree keeps working', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = (): React.ReactNode => {
      throw new Error('aside broke');
    };
    const el = await mount(
      <TestHost id="probe">
        <p data-testid="main">main ok</p>
        <Region name="aside">
          <Boom />
        </Region>
      </TestHost>
    );
    await flush();
    expect(el.querySelector('[data-testid="main"]')?.textContent).toBe('main ok');
    expect(el.querySelector('[data-error-card="probe aside"]')?.textContent).toContain(
      'aside broke'
    );
    spy.mockRestore();
  });

  it('a custom fallback replaces the default card', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = (): React.ReactNode => {
      throw new Error('x');
    };
    const el = await mount(
      <AppBoundary name="a" fallback={(e) => <em>custom {e.message}</em>}>
        <Boom />
      </AppBoundary>
    );
    expect(el.querySelector('em')?.textContent).toBe('custom x');
    spy.mockRestore();
  });

  it('useAppState with an object or array init gives one value across renders', async () => {
    const seen: unknown[] = [];
    const Items = ({ tick }: { tick: number }) => {
      const [items] = useAppState<string[]>('items', []);
      seen.push(items);
      return <span>{`${items.length} ${tick}`}</span>;
    };
    const el = await mount(
      <TestHost id="probe">
        <Items tick={1} />
      </TestHost>
    );
    await act(async () =>
      root?.render(
        <TestHost id="probe">
          <Items tick={2} />
        </TestHost>
      )
    );
    expect(el.textContent).toContain('0 2');
    expect(new Set(seen).size).toBe(1);
  });

  it('useAppShell gives the route: path after /{id}/ and the query', async () => {
    const Where = () => {
      const { route } = useAppShell();
      return <span>{`${route.path}|${route.query.details ?? '-'}`}</span>;
    };
    const el = await mount(
      <TestHost id="memory" route={{ path: 'notes/a.md', query: { details: '1' } }}>
        <Where />
      </TestHost>
    );
    expect(el.textContent).toContain('notes/a.md|1');
    act(() => root?.unmount());
    const home = await mount(
      <TestHost id="memory">
        <Where />
      </TestHost>
    );
    expect(home.textContent).toContain('|-');
  });
});
