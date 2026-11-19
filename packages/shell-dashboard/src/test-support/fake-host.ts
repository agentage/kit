import type { Discovery, EventSourceLike, Session, ShellDeps } from '../host/host.types.js';

type Listener = (e: MessageEvent<string>) => void;
type FakeSource = { -readonly [K in keyof EventSourceLike]: EventSourceLike[K] } & {
  listeners: Map<string, Set<Listener>>;
};

// A fake daemon for unit tests: discovery and session as values, an event feed the test drives.
export const fakeHost = (
  doc: Discovery,
  session: Session = { user: null, host: { kind: 'local' } }
) => {
  const state = { doc, session, closed: 0 };
  const modules = new Map<string, unknown>();
  const calls: string[] = [];
  const apps: (string | null)[] = [];
  const sources: FakeSource[] = [];
  const makeSource = (): FakeSource => {
    const listeners = new Map<string, Set<Listener>>();
    const src: FakeSource = {
      listeners,
      readyState: 1,
      addEventListener: (type, fn) => {
        const set = listeners.get(type) ?? new Set();
        set.add(fn);
        listeners.set(type, set);
      },
      close: () => {
        state.closed++;
        src.readyState = 2;
      },
    };
    sources.push(src);
    return src;
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const deps: ShellDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(url);
      apps.push(new Headers(init?.headers).get('X-Agentage-App'));
      if (url === '/.well-known/agentage-host.json') return json(state.doc);
      if (url === '/shell/session') return json(state.session);
      if (url.startsWith('/api/')) return json({ success: true, data: { url } });
      return json({}, 404);
    },
    events: makeSource,
    importModule: async (url) => {
      if (!modules.has(url)) throw new Error(`no module ${url}`);
      return { default: modules.get(url) };
    },
  };
  const emit = (type: string, data: unknown = {}) =>
    sources
      .at(-1)
      ?.listeners.get(type)
      ?.forEach((fn) => fn(new MessageEvent(type, { data: JSON.stringify(data) })));
  return { deps, state, modules, calls, apps, emit, sources };
};
