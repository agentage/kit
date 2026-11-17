import { useRef, useState } from 'react';
import { rootVarPx, writeStore } from '../lib/storage.js';

const KEY_STEP = 16;
const SHIFT_STEP = 64;

interface SplitterSpec {
  // The root CSS variable the pre-paint script also sets (`--nav-full`, `--side-w`, `--aside-w`, `--bot-h`).
  cssVar: string;
  storeKey: string;
  fallback: number;
  min: number;
  max: () => number;
  // +1 when moving right or down grows the region, -1 when it shrinks it.
  sign: 1 | -1;
  vertical?: boolean;
  label: string;
  className?: string;
}

const clamp = (n: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, n)));

// A frame region splitter (WAI splitter pattern): drag, arrows 16 px, Shift 64 px, Home, End.
export const Splitter = (spec: SplitterSpec) => {
  const [value, setValue] = useState(() =>
    rootVarPx(spec.cssVar, spec.fallback, spec.min, spec.max())
  );
  const drag = useRef<{ start: number; base: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const last = useRef(value);
  const apply = (n: number) => {
    const v = clamp(n, spec.min, spec.max());
    last.current = v;
    document.documentElement.style.setProperty(spec.cssVar, `${v}px`);
    setValue(v);
    return v;
  };
  const save = (v: number) => writeStore(spec.storeKey, String(v));
  const pos = (e: React.PointerEvent) => (spec.vertical ? e.clientY : e.clientX);
  const end = () => {
    drag.current = null;
    setDragging(false);
    document.body.classList.remove('dragging');
    save(last.current);
  };
  return (
    // The WAI splitter pattern: a focusable separator with a value, moved by keys and drag.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={`sep ${spec.vertical ? 'h' : 'v'}${dragging ? ' drag' : ''} ${spec.className ?? ''}`}
      role="separator"
      aria-orientation={spec.vertical ? 'horizontal' : 'vertical'}
      aria-label={spec.label}
      aria-valuenow={value}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max()}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { start: pos(e), base: value };
        setDragging(true);
        document.body.classList.add('dragging');
      }}
      onPointerMove={(e) => {
        if (drag.current) apply(drag.current.base + spec.sign * (pos(e) - drag.current.start));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        const step = e.shiftKey ? SHIFT_STEP : KEY_STEP;
        const k = e.key;
        const fwd = spec.vertical ? 'ArrowDown' : 'ArrowRight';
        const back = spec.vertical ? 'ArrowUp' : 'ArrowLeft';
        let next: number | null = null;
        if (k === fwd) next = value + spec.sign * step;
        else if (k === back) next = value - spec.sign * step;
        else if (k === 'Home') next = spec.min;
        else if (k === 'End') next = spec.max();
        if (next === null) return;
        e.preventDefault();
        save(apply(next));
      }}
    />
  );
};

export const NAV_SPLIT = {
  cssVar: '--nav-full',
  storeKey: 'ag.nav',
  fallback: 280,
  min: 232,
  max: () => 420,
  sign: 1,
  label: 'Resize sidebar',
} as const satisfies SplitterSpec;

export const ASIDE_SPLIT = {
  cssVar: '--aside-w',
  storeKey: 'ag.aside',
  fallback: 360,
  min: 280,
  max: () => 640,
  sign: -1,
  label: 'Resize aside',
} as const satisfies SplitterSpec;

export const SIDE_SPLIT = {
  cssVar: '--side-w',
  storeKey: 'ag.side',
  fallback: 260,
  min: 200,
  max: () => 420,
  sign: 1,
  label: 'Resize side pane',
} as const satisfies SplitterSpec;

export const BOTTOM_SPLIT: SplitterSpec = {
  cssVar: '--bot-h',
  storeKey: 'ag.bot',
  fallback: 220,
  min: 100,
  max: () => Math.max(100, Math.min(420, window.innerHeight - 200)),
  sign: -1,
  vertical: true,
  label: 'Resize bottom panel',
};
