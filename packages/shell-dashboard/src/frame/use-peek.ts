import { useRef, useState, type FocusEvent } from 'react';

const PEEK_MS = 200;

// The hidden nav peeks while the pointer or focus is on it or on the show button (index.html).
export const usePeek = (navHidden: boolean) => {
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const on = () => {
    clearTimeout(timer.current);
    if (navHidden && !window.matchMedia('(max-width: 759px)').matches) setPeek(true);
  };
  const soon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(false), PEEK_MS);
  };
  const handlers = {
    onPointerEnter: on,
    onPointerLeave: soon,
    onFocus: on,
    onBlur: (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      const zone = ['nav', 'show'].some((id) => document.getElementById(id)?.contains(next));
      if (!zone) soon();
    },
  };
  return { peek: peek && navHidden, handlers };
};
