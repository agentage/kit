import { IconButton } from '@agentage/design-system/icon-button';
import { Kbd } from '@agentage/design-system/kbd';
import type { RegionName } from '@agentage/app';
import { Bell, PanelLeft, Search } from 'lucide-react';
import { AccountMenu } from './account-menu.js';
import type { Account, NavRow } from './frame.types.js';
import { Brand } from './logo.js';
import { NAV_SPLIT, Splitter } from './splitter.js';
import type { FrameState } from './use-frame-state.js';

interface Props {
  rows: NavRow[];
  account: Account;
  version: string;
  unread: number;
  state: FrameState;
  regionRef: (name: RegionName) => (el: HTMLElement | null) => void;
  onNavigate: (href: string) => void;
  onInbox: () => void;
}

const icon = <PanelLeft className="i" aria-hidden="true" />;

export const Nav = ({ rows, account, version, unread, state, regionRef, ...on }: Props) => {
  const hideLabel = state.navHidden ? 'Dock sidebar' : 'Hide sidebar';
  return (
    <nav className="side" data-region="nav" id="nav" aria-label="Primary">
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
        <div data-region="notices" ref={regionRef('notices')} style={{ display: 'contents' }}>
          <button className="row" title="Inbox" onClick={on.onInbox}>
            <Bell className="i" aria-hidden="true" />
            <span className="lbl">Inbox</span>
            <span className="pill" hidden={!unread}>
              {unread}
            </span>
          </button>
        </div>
        {rows.map((r) => (
          <a
            key={r.id}
            className="row"
            href={r.href}
            title={r.title}
            aria-current={r.current ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              state.setDrawer(false);
              on.onNavigate(r.href);
            }}
          >
            {r.icon}
            <span className="lbl">{r.title}</span>
          </a>
        ))}
      </div>
      <div className="foot" data-region="account">
        <AccountMenu
          account={account}
          version={version}
          onPalette={() => state.setPalette(true)}
          onToggleNav={state.toggleNav}
        />
      </div>
      <Splitter {...NAV_SPLIT} />
    </nav>
  );
};
