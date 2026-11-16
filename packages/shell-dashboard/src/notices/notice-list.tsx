import type { NoticeKind, RegionHost } from '@agentage/app';
import { Button } from '@agentage/design-system/button';
import { ToastProvider, useToast } from '@agentage/design-system/toast';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NOTICE_LIFE_MS, unreadOf, type Notices } from './notices.js';

// The design-system toast variants: ok is success, error is destructive.
export const TOAST_VARIANT = { ok: 'success', error: 'destructive', info: 'info' } as const;
export const variantOf = (kind: NoticeKind = 'info') => TOAST_VARIANT[kind];

const Bridge = ({ notices }: { notices: Notices }) => {
  const { toast } = useToast();
  useEffect(
    () =>
      notices.onPush((n) =>
        toast({
          title: n.text,
          variant: variantOf(n.kind),
          duration: NOTICE_LIFE_MS,
        })
      ),
    [notices, toast]
  );
  return null;
};

// Each new notice is a design-system toast for 5 s; the history stays in the inbox.
export const Toasts = ({ notices, children }: { notices: Notices; children: ReactNode }) => (
  <ToastProvider>
    <Bridge notices={notices} />
    {children}
  </ToastProvider>
);

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// `?inbox=1`: the history in the aside, unread first marked; opening it clears the count.
export const InboxBody = ({ regions, notices }: { regions: RegionHost; notices: Notices }) => {
  const list = useSyncExternalStore(notices.subscribe, notices.list, notices.list);
  const node = useSyncExternalStore(
    regions.subscribe,
    () => regions.node('aside'),
    () => null
  );
  const unread = unreadOf(list);
  if (!node) return null;
  return createPortal(
    <div data-inbox="">
      <div className="ntools">
        <span>{unread ? `${unread} unread` : list.length ? 'All read' : 'All caught up'}</span>
        <Button variant="ghost" size="sm" disabled={!unread} onClick={notices.markAllRead}>
          Mark all read
        </Button>
      </div>
      {list.map((n) => (
        <div key={n.key} className={n.read ? 'nitem read' : 'nitem'} data-kind={n.kind ?? 'info'}>
          <span className="nd" />
          <div>
            <b>{n.text}</b>
            <span>
              {n.app} · <time dateTime={new Date(n.at).toISOString()}>{time(n.at)}</time>
            </span>
          </div>
        </div>
      ))}
    </div>,
    node
  );
};
