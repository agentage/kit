import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAppContext } from './context.js';

const KEY_STEP = 16;
const SHIFT_STEP = 64;
const NAME = /^[a-z0-9-]+$/;

export const splitVar = (app: string, id: string): string => `--split-${app}-${id}`;
export const splitKey = (app: string, id: string): string => `ag.split.${app}.${id}`;

// Runs in the page head before any module: sets each stored split size, so the first paint is final.
export const SPLIT_PREPAINT = `try{var d=document.documentElement,L=localStorage;for(var i=0;i<L.length;i++){var k=L.key(i),m=/^ag\\.split\\.([a-z0-9-]+)\\.([a-z0-9-]+)$/.exec(k),n=parseInt(L.getItem(k),10);if(m&&n>0&&n<8000)d.style.setProperty('--split-'+m[1]+'-'+m[2],n+'px')}}catch(e){}`;

export interface SplitProps {
  // Unique in the app, `[a-z0-9-]`; names the stored size and `data-split`.
  id: string;
  // First pane width in px before any drag, and the clamp of a stored value.
  init: number;
  min: number;
  max: number;
  label?: string;
  // Hides the first pane (a tree toggle); the stored size stays.
  collapsed?: boolean;
  // Below 760 px one pane shows: 0 the first, 1 the second (default); the app gives the back button.
  pane?: 0 | 1;
  children: [ReactNode, ReactNode];
}

const PHONE = '(max-width: 759px)';
const usePhone = (): boolean => {
  const query = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE).matches;
  const [phone, setPhone] = useState(query);
  useEffect(() => {
    const m = window.matchMedia?.(PHONE);
    const on = () => setPhone(m.matches);
    m?.addEventListener('change', on);
    return () => m?.removeEventListener('change', on);
  }, []);
  return phone;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const stored = (name: string, init: number): number => {
  if (typeof document === 'undefined') return init;
  const raw = document.documentElement.style.getPropertyValue(name);
  return parseInt(raw, 10) || init;
};

// Two panes of an app, the first one resizable; the size holds across a reload with no layout shift.
export const Split = (props: SplitProps) => {
  const { id, init, min, max, label, collapsed = false, pane = 1, children } = props;
  const { id: app } = useAppContext();
  if (!NAME.test(id)) throw new Error(`Split id "${id}" must match [a-z0-9-]+`);
  const name = splitVar(app, id);
  const [width, setWidth] = useState(() => clamp(stored(name, init), min, max));
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const phone = usePhone();

  useEffect(() => {
    document.documentElement.style.setProperty(name, `${width}px`);
    try {
      localStorage.setItem(splitKey(app, id), String(width));
    } catch {
      // Storage blocked: the size lives for this page only.
    }
  }, [app, id, name, width]);

  const set = (n: number) => setWidth(clamp(Math.round(n), min, max));
  const one = phone || collapsed;
  const hide0 = phone ? pane !== 0 : collapsed;
  const style = {
    display: 'grid',
    gridTemplateColumns: one
      ? 'minmax(0, 1fr)'
      : `clamp(${min}px, var(${name}, ${init}px), ${max}px) minmax(0, 1fr)`,
    height: '100%',
    minHeight: 0,
  } as CSSProperties;
  return (
    <div
      className="split"
      data-split={id}
      data-collapsed={collapsed || undefined}
      data-phone={phone ? pane : undefined}
      ref={root}
      style={style}
    >
      <div
        className="pane0"
        hidden={hide0}
        style={{ position: 'relative', minWidth: 0, minHeight: 0 }}
      >
        {children[0]}
        {/* The WAI splitter pattern: a focusable separator with a value, moved by keys and drag. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className="sep v"
          role="separator"
          aria-orientation="vertical"
          aria-label={label ?? 'Resize panes'}
          aria-valuenow={width}
          aria-valuemin={min}
          aria-valuemax={max}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          hidden={one}
          style={{ right: -3 }}
          onPointerDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const left = root.current?.getBoundingClientRect().left ?? 0;
            if (dragging.current) set(e.clientX - left);
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? SHIFT_STEP : KEY_STEP;
            const delta = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
            if (e.key === 'Home') set(min);
            else if (e.key === 'End') set(max);
            else if (delta) set(width + delta);
            else return;
            e.preventDefault();
          }}
        />
      </div>
      <div className="pane1" hidden={phone && pane === 0} style={{ minWidth: 0, minHeight: 0 }}>
        {children[1]}
      </div>
    </div>
  );
};
