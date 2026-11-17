import { useMemo, useState, type ReactNode } from 'react';
import type {
  AppContextValue,
  AppRoute,
  AppUser,
  AsideKey,
  BottomBar,
  HostAdapter,
  Notice,
  PageLink,
  RegionHost,
  RegionName,
  StateStore,
} from './app.types.js';
import { AppContext } from './context.js';
import { createStateStore } from './state-store.js';

export interface TestCall {
  id: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

// What a test reads back after the app ran: notices, api calls, the aside and pages it asked for.
export interface TestRecord {
  notices: Notice[];
  calls: TestCall[];
  aside: AsideKey | null;
  pages: string[];
  pageLinks: PageLink[];
  bottomBar: BottomBar | null;
}

export interface TestHostProps {
  id: string;
  children: ReactNode;
  user?: AppUser | null;
  scopes?: string[];
  // The api reply for a path; the default echoes `{ path }` in an ok envelope.
  reply?: (call: TestCall) => unknown;
  record?: TestRecord;
  store?: StateStore;
  route?: AppRoute;
}

const REGIONS: RegionName[] = ['lead', 'actions', 'aside', 'notices', 'bottom', 'side'];
const TEST_USER: AppUser = { id: 'u-test', name: 'Test User' };
const NO_SCOPES: string[] = [];
const HOME: AppRoute = { path: '', query: {} };
const echo = (call: TestCall): unknown => ({ path: call.path });

export const createTestRecord = (): TestRecord => ({
  notices: [],
  calls: [],
  aside: null,
  pages: [],
  pageLinks: [],
  bottomBar: null,
});

const testRequest =
  (record: TestRecord, reply: (call: TestCall) => unknown): HostAdapter['request'] =>
  async (id, path, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { id, path, method: init.method ?? 'GET', headers, body };
    record.calls.push(call);
    return new Response(JSON.stringify({ success: true, data: reply(call) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };

const testShell = (record: TestRecord): AppContextValue['shell'] => ({
  notify: (n) => void record.notices.push(n),
  openAside: (key) => void (record.aside = key),
  closeAside: () => void (record.aside = null),
  navigate: (page) => void record.pages.push(page),
  setPages: (pages) => void (record.pageLinks = pages),
  setBottomBar: (bar) => void (record.bottomBar = bar),
});

const useRegionHost = (): [RegionHost, (name: RegionName) => (el: HTMLElement | null) => void] => {
  const [nodes] = useState(() => new Map<RegionName, HTMLElement>());
  const [listeners] = useState(() => new Set<() => void>());
  const host = useMemo<RegionHost>(
    () => ({
      node: (name) => nodes.get(name) ?? null,
      subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    }),
    [nodes, listeners]
  );
  const ref = (name: RegionName) => (el: HTMLElement | null) => {
    if (el) nodes.set(name, el);
    else nodes.delete(name);
    listeners.forEach((fn) => fn());
  };
  return [host, ref];
};

// A small shell for unit tests of an app: the six regions as divs and an in-memory host.
export const TestHost = (props: TestHostProps) => {
  const [record] = useState(() => props.record ?? createTestRecord());
  const [store] = useState(() => props.store ?? createStateStore());
  const [regions, regionRef] = useRegionHost();
  const { id, user = TEST_USER, scopes = NO_SCOPES, reply = echo, route = HOME } = props;
  const value = useMemo<AppContextValue>(
    () => ({
      id,
      route,
      store,
      regions,
      host: { user, scopes, request: testRequest(record, reply) },
      shell: testShell(record),
    }),
    [id, route, store, regions, user, scopes, record, reply]
  );
  return (
    <AppContext.Provider value={value}>
      <div data-region="main">{props.children}</div>
      {REGIONS.map((name) => (
        <div key={name} data-region={name} ref={regionRef(name)} />
      ))}
    </AppContext.Provider>
  );
};
