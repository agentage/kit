import { useCallback, useEffect, useState } from 'react';
import { writeStore } from '../lib/storage.js';

const MOBILE = '(max-width: 759px)';
const isMobile = () => window.matchMedia(MOBILE).matches;
const rootHas = (cls: string) => document.documentElement.classList.contains(cls);

// The frame's own UI state; the pre-paint script set `nh` and `bo` on <html> before React.
export const useFrameState = () => {
  const [navHidden, setNavHidden] = useState(() => rootHas('nh'));
  const [bottomOpen, setBottomOpen] = useState(() => rootHas('bo'));
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('nh', navHidden);
    writeStore('ag.navh', navHidden ? '1' : '0');
  }, [navHidden]);
  useEffect(() => {
    document.documentElement.classList.toggle('bo', bottomOpen);
    writeStore('ag.bot.open', bottomOpen ? '1' : '0');
  }, [bottomOpen]);
  useEffect(() => {
    document.body.classList.toggle('drawer', drawer);
  }, [drawer]);

  const toggleNav = useCallback(() => {
    if (isMobile()) setDrawer((d) => !d);
    else setNavHidden((h) => !h);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === 'Escape') setDrawer(false);
    };
    const onResize = () => !isMobile() && setDrawer(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return {
    navHidden,
    setNavHidden,
    bottomOpen,
    setBottomOpen,
    drawer,
    setDrawer,
    palette,
    setPalette,
    toggleNav,
  };
};

export type FrameState = ReturnType<typeof useFrameState>;
