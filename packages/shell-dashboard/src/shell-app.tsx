import { createStateStore, type AsideKey } from '@agentage/app';
import { useEffect, useState } from 'react';
import { createAppBars, useAppBars } from './chrome/app-bars.js';
import { Frame } from './frame/frame.js';
import type { Account } from './frame/frame.types.js';
import { createRegionHost } from './frame/regions.js';
import { useHostFeeds } from './host/feeds.js';
import type { ShellDeps } from './host/host.types.js';
import { safePath, safeSignIn } from './host/safe-sign-in.js';
import { signOut } from './host/sign-out.js';
import { AppPage } from './loader/app-page.js';
import { InboxBody, Toasts } from './notices/notice-list.js';
import { createNotices, unreadOf, useNotices } from './notices/notices.js';
import { appRows, navRowsOf, type AppExtension } from './route/nav-rows.js';
import { Home, NoExtensions, NotFound, Removed } from './route/pages.js';
import { navigate, setAside, useRoute, type Route } from './route/router.js';
import { createPorts, initials } from './shell-ports.js';

const ASIDE_TITLE: Record<AsideKey, string> = {
  inspect: 'Inspect',
  details: 'Details',
  inbox: 'Inbox',
};

// The account extension's routes; with no `account` app the menu items stay hidden.
const accountLinks = (rows: AppExtension[]): Account['links'] =>
  rows.some((r) => r.id === 'account')
    ? { settings: '/account/settings', tokens: '/account/tokens', signOut: '/account/sign-out' }
    : undefined;

const toggleAside = (route: Route, key: AsideKey) => setAside(route.aside === key ? null : key);

// The shell: discovery and session from the daemon, the route, the open app with its context.
export const ShellApp = ({ deps, version }: { deps: ShellDeps; version: string }) => {
  const [regions] = useState(createRegionHost);
  const [store] = useState(createStateStore);
  const [notices] = useState(() => createNotices());
  const [bars] = useState(createAppBars);
  const [shellFor] = useState(() => createPorts(notices, bars));
  const list = useNotices(notices);
  const { discovery, session, seen, reloadSession } = useHostFeeds(deps);
  const route = useRoute();
  const rows = appRows(discovery);
  const row = rows.find((r) => r.id === route.id);
  const own = useAppBars(bars, row?.id ?? '');
  const user = session?.user ?? null;
  const label = user ? (user.name ?? user.email ?? user.id) : null;
  const signIn = user ? undefined : safeSignIn(session?.signIn, location.origin);
  const out = user ? safePath(session?.signOut, location.origin) : undefined;
  const inboxOpen = route.aside === 'inbox';
  useEffect(() => {
    if (inboxOpen) notices.markAllRead();
  }, [inboxOpen, notices]);

  const removed = !row && discovery && seen[route.id];
  const title = row?.app.title ?? (route.id ? (removed ? removed : 'Not found') : 'Home');
  let page = null;
  // The app waits for the session: its adapter follows the host kind.
  if (row && session)
    page = (
      <AppPage
        key={row.id}
        row={row}
        session={session}
        deps={deps}
        shell={shellFor(row.id)}
        route={route.app}
        store={store}
        regions={regions}
      />
    );
  else if (row || !discovery) page = null;
  else if (removed) page = <Removed title={removed} />;
  else if (route.id) page = <NotFound path={location.pathname} />;
  else page = rows.length ? <Home /> : <NoExtensions />;

  return (
    <Toasts notices={notices}>
      <Frame
        rows={navRowsOf(rows, route.id)}
        account={{
          label,
          initials: initials(label),
          pending: !session,
          links: accountLinks(rows),
          ...(signIn && { signIn }),
          ...(out && { onSignOut: () => signOut(deps, out, reloadSession) }),
        }}
        apps={rows.map((r) => ({ id: r.id, version: r.version }))}
        version={version}
        title={title}
        pages={own.pages.map((p) => {
          const path = p.path.replace(/^\/+/, '');
          return {
            title: p.title,
            href: `/${route.id}${path && `/${path}`}`,
            current: path === route.page,
          };
        })}
        bottom={row ? own.bottom : null}
        unread={unreadOf(list)}
        aside={
          route.aside
            ? { title: ASIDE_TITLE[route.aside], key: route.aside, onClose: () => setAside(null) }
            : null
        }
        regionRef={regions.ref}
        onNavigate={navigate}
        onInbox={() => toggleAside(route, 'inbox')}
        onDetails={row ? () => toggleAside(route, 'details') : undefined}
      >
        {page}
        {inboxOpen && <InboxBody regions={regions} notices={notices} />}
      </Frame>
    </Toasts>
  );
};
