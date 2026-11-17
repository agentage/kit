import type { BottomBar, PageLink } from '@agentage/app';
import { useSyncExternalStore } from 'react';

interface AppBars {
  pages: PageLink[];
  bottom: BottomBar | null;
}

const NONE: AppBars = { pages: [], bottom: null };

// What each app gave for the frame bars (title page menu, bottom bar), kept per app id.
export const createAppBars = () => {
  let byId: ReadonlyMap<string, AppBars> = new Map();
  const listeners = new Set<() => void>();
  const set = (id: string, part: Partial<AppBars>) => {
    const next = new Map(byId);
    next.set(id, { ...(byId.get(id) ?? NONE), ...part });
    byId = next;
    listeners.forEach((fn) => fn());
  };
  return {
    setPages: (id: string, pages: PageLink[]) => set(id, { pages }),
    setBottom: (id: string, bottom: BottomBar | null) => set(id, { bottom }),
    snapshot: () => byId,
    subscribe: (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn)),
  };
};

export type AppBarsStore = ReturnType<typeof createAppBars>;

export const useAppBars = (bars: AppBarsStore, id: string): AppBars =>
  useSyncExternalStore(bars.subscribe, bars.snapshot, bars.snapshot).get(id) ?? NONE;
