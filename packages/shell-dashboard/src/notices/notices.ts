import type { Notice } from '@agentage/app';
import { useSyncExternalStore } from 'react';

export interface ShellNotice extends Notice {
  key: number;
  app: string;
  // Epoch ms; the inbox shows the time.
  at: number;
  read: boolean;
}

export const NOTICE_LIFE_MS = 5000;
export const HISTORY_MAX = 100;

// The page's notice history (the inbox, newest first); toasts are separate and live 5 s each.
export const createNotices = (now: () => number = Date.now) => {
  let list: ShellNotice[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const pushed = new Set<(n: ShellNotice) => void>();
  const emit = () => listeners.forEach((fn) => fn());
  return {
    push: (app: string, notice: Notice) => {
      const n = { ...notice, key: next++, app, at: now(), read: false };
      list = [n, ...list].slice(0, HISTORY_MAX);
      emit();
      pushed.forEach((fn) => fn(n));
    },
    markAllRead: () => {
      if (!list.some((n) => !n.read)) return;
      list = list.map((n) => (n.read ? n : { ...n, read: true }));
      emit();
    },
    list: () => list,
    subscribe: (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn)),
    // Each new notice once, for the toasts.
    onPush: (fn: (n: ShellNotice) => void) => (pushed.add(fn), () => void pushed.delete(fn)),
  };
};

export type Notices = ReturnType<typeof createNotices>;

export const useNotices = (notices: Notices): ShellNotice[] =>
  useSyncExternalStore(notices.subscribe, notices.list, notices.list);

export const unreadOf = (list: ShellNotice[]): number => list.filter((n) => !n.read).length;
