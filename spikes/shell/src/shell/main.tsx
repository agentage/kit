// Spike shell: frame regions, loader, SSE remount, per-app state. React and @agentage/app come from the import map.
import {
  Component,
  useEffect,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { AppContext, type AppShell, type RegionName } from '@agentage/app';

interface Row {
  id: string;
  title: string;
  entry: string;
}
type Mark = { id: string; entry: string; recv: number; commit?: number; paint?: number };
type Win = Window & { __timings: Mark[]; __hooks: Set<unknown>; __shellReact: unknown };
const w = window as unknown as Win;
w.__timings = [];
w.__hooks = w.__hooks ?? new Set();
const now = () => performance.timeOrigin + performance.now();

const store = new Map<string, Map<string, unknown>>();
const regionNodes = new Map<string, HTMLElement>();
const regionSubs = new Set<() => void>();
const notices: string[] = [];

const makeShell = (id: string, onNotice: () => void): AppShell => ({
  id,
  notify: ({ text }) => {
    notices.push(text);
    onNotice();
  },
  state: <T,>(key: string, init: T) => {
    const bag = store.get(id) ?? store.set(id, new Map()).get(id)!;
    const [v, setV] = useState<T>(() => (bag.has(key) ? (bag.get(key) as T) : init));
    return [v, (n: T) => (bag.set(key, n), setV(n))];
  },
  region: (name: RegionName) => regionNodes.get(name) ?? null,
  subscribeRegions: (fn) => (regionSubs.add(fn), () => regionSubs.delete(fn)),
});

const regionRef = (name: string) => (el: HTMLElement | null) => {
  if (el) regionNodes.set(name, el);
  else regionNodes.delete(name);
  regionSubs.forEach((f) => f());
};

class Boundary extends Component<{ children: ReactNode; id: string }, { err?: string }> {
  state: { err?: string } = {};
  static getDerivedStateFromError(e: Error) {
    return { err: e.message };
  }
  render() {
    if (this.state.err)
      return (
        <div className="card-err" data-error-card={this.props.id}>
          App {this.props.id} failed: {this.state.err}
        </div>
      );
    return this.props.children;
  }
}

// Marks commit (layout effect) and paint (next frame) of the remount that a reload event caused.
const Marker = ({ entry }: { entry: string }) => {
  useLayoutEffect(() => {
    const m = w.__timings.find((t) => t.entry === entry && !t.commit);
    if (!m) return;
    m.commit = now();
    requestAnimationFrame(() => setTimeout(() => (m.paint = now())));
  }, [entry]);
  return null;
};

const user = { name: 'Alex Doe' };
const AppRoot = ({ row, mod, tick }: { row: Row; mod: ComponentType; tick: () => void }) => {
  const App = mod;
  const host = {
    user,
    api: (p: string) =>
      fetch(`/api/${row.id}${p}`, { headers: { 'X-Agentage-App': row.id } }).then((r) => r.json()),
  };
  return (
    <AppContext.Provider value={{ shell: makeShell(row.id, tick), host }}>
      <Boundary id={row.id} key={row.entry}>
        <App />
        <Marker entry={row.entry} />
      </Boundary>
    </AppContext.Provider>
  );
};

const useRows = () => {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void fetch('/discovery')
      .then((r) => r.json())
      .then(setRows);
    const es = new EventSource('/shell/events');
    es.addEventListener('app', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as { id: string; entry: string };
      w.__timings.push({ ...ev, recv: now() });
      setRows((rs) => rs.map((r) => (r.id === ev.id ? { ...r, entry: ev.entry } : r)));
    });
    return () => es.close();
  }, []);
  return rows;
};

const useModule = (entry?: string) => {
  const [mod, setMod] = useState<
    { entry: string; c: ComponentType } | { entry: string; err: string }
  >();
  useEffect(() => {
    if (!entry) return;
    import(/* @vite-ignore */ entry).then(
      (m: { default: ComponentType }) => setMod({ entry, c: m.default }),
      (e: Error) => setMod({ entry, err: e.message })
    );
  }, [entry]);
  return mod;
};

const routeId = () => location.pathname.split('/')[1] || '';

const Frame = () => {
  const rows = useRows();
  const [id, setId] = useState(routeId);
  const [, setN] = useState(0);
  const row = rows.find((r) => r.id === id);
  const mod = useModule(row?.entry);
  const go = (to: string) => (history.pushState(null, '', `/${to}`), setId(to));
  const asideOpen = new URLSearchParams(location.search).has('details');
  return (
    <div className={`app${asideOpen ? ' aside-open' : ''}`}>
      <nav className="side" data-region="nav" aria-label="Primary">
        <div className="sidehead">
          <span className="brand">agentage</span>
        </div>
        <div className="mid">
          <div data-region="notices" ref={regionRef('notices')} style={{ display: 'contents' }}>
            <button className="row" data-notices={notices.length}>
              <span className="lbl">Inbox</span>
              <span className="pill">{notices.length}</span>
            </button>
          </div>
          {rows.map((r) => (
            <button
              key={r.id}
              className="row"
              aria-current={r.id === id ? 'page' : undefined}
              onClick={() => go(r.id)}
            >
              <span className="lbl">{r.title}</span>
            </button>
          ))}
        </div>
        <div className="foot" data-region="account">
          <span className="who">
            <b>{user.name}</b>
            <span>shell spike</span>
          </span>
        </div>
      </nav>
      <div className="center">
        <main data-region="main">
          <div className="abar" data-region="actions" ref={regionRef('actions')} />
          {row && mod && 'c' in mod ? (
            <AppRoot
              row={{ ...row, entry: mod.entry }}
              mod={mod.c}
              tick={() => setN((n) => n + 1)}
            />
          ) : null}
          {mod && 'err' in mod ? <div className="card-err">Import failed: {mod.err}</div> : null}
        </main>
      </div>
      <aside className="insp" data-region="aside" aria-label="Inspector">
        <div className="ai">
          <div className="ahead">
            <h2>Details</h2>
          </div>
          <div className="abody" ref={regionRef('aside')} />
        </div>
      </aside>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Frame />);
w.__hooks.add(useState);
