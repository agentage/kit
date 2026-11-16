// Spike of `@agentage/app`: served once at /shell/vendor/app.js; the shell and every app import it by name.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type RegionName = 'aside' | 'actions' | 'notices' | 'bottom' | 'side';

export interface AppShell {
  id: string;
  notify: (n: { text: string }) => void;
  state: <T>(key: string, init: T) => [T, (v: T) => void];
  region: (name: RegionName) => HTMLElement | null;
  subscribeRegions: (fn: () => void) => () => void;
}

export interface AppHost {
  user: { name: string };
  api: (path: string) => Promise<unknown>;
}

export const AppContext = createContext<{ shell: AppShell; host: AppHost } | null>(null);

const use = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('outside AppContext');
  return ctx;
};

export const useAppShell = (): AppShell => use().shell;
export const useAppHost = (): AppHost => use().host;

// Kept by the shell per app id, so a remount with a new module keeps the value.
export const useAppState = <T,>(key: string, init: T) => useAppShell().state(key, init);

export const Region = ({ name, children }: { name: RegionName; children: ReactNode }) => {
  const shell = useAppShell();
  const node = useSyncExternalStore(shell.subscribeRegions, () => shell.region(name));
  return node ? createPortal(children, node) : null;
};

const cssVar = (app: string, id: string) => `--split-${app}-${id}`;

// Pre-paint script in index.html sets the var from localStorage `ag.split.{app}.{id}` before any module loads.
export const Split = (p: {
  id: string;
  init: number;
  min: number;
  max: number;
  children: [ReactNode, ReactNode];
}) => {
  const { id: app } = useAppShell();
  const name = cssVar(app, p.id);
  const root = document.documentElement;
  const read = () => parseInt(getComputedStyle(root).getPropertyValue(name), 10) || p.init;
  const [w, setW] = useState(read);
  const drag = useRef(false);
  const set = (n: number) => {
    const v = Math.min(p.max, Math.max(p.min, n));
    root.style.setProperty(name, `${v}px`);
    setW(v);
  };
  useEffect(() => {
    try {
      localStorage.setItem(`ag.split.${app}.${p.id}`, String(w));
    } catch {
      /* storage blocked: size lives for this page only */
    }
  }, [w, app, p.id]);
  const onMove = (e: React.PointerEvent) =>
    drag.current && set(e.clientX - e.currentTarget.getBoundingClientRect().left);
  return (
    <div
      className="split"
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = false)}
      data-split={p.id}
    >
      <div className="pane0" style={{ ['--sw' as string]: `var(${name}, ${p.init}px)` }}>
        {p.children[0]}
        <div
          className="sep v"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={w}
          aria-valuemin={p.min}
          aria-valuemax={p.max}
          tabIndex={0}
          onPointerDown={(e) => {
            drag.current = true;
            e.currentTarget.parentElement?.parentElement?.setPointerCapture(e.pointerId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') set(w - 16);
            if (e.key === 'ArrowRight') set(w + 16);
          }}
        />
      </div>
      <div className="pane1">{p.children[1]}</div>
    </div>
  );
};
