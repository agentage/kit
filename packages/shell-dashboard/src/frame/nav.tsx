import { IconButton } from '@agentage/components/icon-button';
import { Kbd } from '@agentage/components/kbd';
import type { RegionName } from '@agentage/app';
import type { MouseEvent } from 'react';
import { Bell, PanelLeft, Search } from 'lucide-react';
import { AccountMenu } from './account-menu.js';
import type { Account, NavRow, NavSectionView } from './frame.types.js';
import { Brand } from './logo.js';
import { NAV_SPLIT, Splitter } from './splitter.js';
import type { usePeek } from './use-peek.js';
import type { FrameState } from './use-frame-state.js';

interface Props {
  rows: NavRow[];
  section: NavSectionView | null;
  account: Account;
  version: string;
  apps: { id: string; version: string }[];
  unread: number;
  state: FrameState;
  regionRef: (name: RegionName) => (el: HTMLElement | null) => void;
  peek: ReturnType<typeof usePeek>;
  onNavigate: (href: string) => void;
  onInbox: () => void;
}

const NavSection = ({
  section,
  go,
}: {
  section: NavSectionView;
  go: (e: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) => (
  <div className="navsect" role="group" aria-labelledby="navsect-title">
    <div className="sect" id="navsect-title">
      {section.title}
    </div>
    <div className="sectlist">
      {section.items.map((it) => (
        <a
          key={it.href}
          className="row"
          href={it.href}
          title={it.title}
          aria-current={it.current ? 'page' : undefined}
          onClick={(e) => go(e, it.href)}
        >
          {it.icon}
          <span className="lbl">{it.title}</span>
        </a>
      ))}
    </div>
  </div>
);

const icon = <PanelLeft className="i" aria-hidden="true" />;

export const Nav = ({
  rows,
  section,
  account,
  version,
  apps,
  unread,
  state,
  regionRef,
  peek,
  ...on
}: Props) => {
  const go = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    state.setDrawer(false);
    on.onNavigate(href);
  };
  const hideLabel = state.navHidden ? 'Dock sidebar' : 'Hide sidebar';
  return (
    <nav
      className={peek.peek ? 'side peek' : 'side'}
      data-region="nav"
      id="nav"
      aria-label="Primary"
      {...peek.handlers}
    >
      <div className="sidehead">
        <Brand />
        <IconButton
          className="ib rounded-lg"
          icon={icon}
          aria-label={hideLabel}
          title={hideLabel}
          onClick={state.toggleNav}
        />
      </div>
      <div className="mid">
        <button className="row search" title="Search" onClick={() => state.setPalette(true)}>
          <Search className="i" aria-hidden="true" />
          <span className="lbl">Search</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        {rows.map((r) => (
          <a
            className="row"
            href={r.href}
            title={r.title}
            aria-current={r.current ? 'page' : undefined}
            onClick={(e) => go(e, r.href)}
          >
            {r.icon}
            <span className="lbl">{r.title}</span>
          </a>
        ))}
        {section && <NavSection section={section} go={go} />}
      </div>
      <div className="foot">
        <div className="acctslot" data-region="account">
          <AccountMenu
            account={account}
            version={version}
            apps={apps}
            onPalette={() => state.setPalette(true)}
            onToggleNav={state.toggleNav}
            onNavigate={on.onNavigate}
          />
        </div>
        {/* No built-in nav row: the inbox sits in the foot, the nav rows come only from extensions. */}
        <div data-region="notices" ref={regionRef('notices')} style={{ display: 'contents' }}>
          <button
            className="ib inboxbtn"
            title="Inbox"
            aria-label={unread ? `Inbox, ${unread} notices` : 'Inbox'}
            onClick={on.onInbox}
          >
            <Bell className="i" aria-hidden="true" />
            <span className="pill" hidden={!unread}>
              {unread}
            </span>
          </button>
        </div>
      </div>
      <Splitter {...NAV_SPLIT} />
    </nav>
  );
};
