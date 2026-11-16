import type { RegionName } from '@agentage/app';
import { PanelLeft } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Aside } from './aside.js';
import { CommandList } from './command-list.js';
import type { Account, AsideState, Command, NavRow } from './frame.types.js';
import { MobileHeader } from './mobile-header.js';
import { Nav } from './nav.js';
import { BOTTOM_SPLIT, Splitter } from './splitter.js';
import { useFrameState } from './use-frame-state.js';

export interface FrameProps {
  rows: NavRow[];
  account: Account;
  version: string;
  // The title in the actions bar (the open app's title).
  title: string;
  aside: AsideState | null;
  unread?: number;
  // The bottom region shows only when an app fills it (S1.4.1); closed by default.
  bottom?: string | null;
  regionRef: (name: RegionName) => (el: HTMLElement | null) => void;
  onNavigate: (href: string) => void;
  onInbox?: () => void;
  children: ReactNode;
}

const navIcon = <PanelLeft className="i" aria-hidden="true" />;

// The frame of shell-samples/index.html (variant B): nav, main with actions, bottom, aside.
export const Frame = (p: FrameProps) => {
  const state = useFrameState();
  const [wide, setWide] = useState(false);
  const onInbox = p.onInbox ?? (() => undefined);
  const commands = useMemo<Command[]>(
    () => [
      ...p.rows.map((r) => ({
        id: `go-${r.id}`,
        label: `Go to ${r.title}`,
        icon: r.icon,
        run: () => p.onNavigate(r.href),
      })),
      { id: 'toggle-nav', label: 'Toggle sidebar', icon: navIcon, run: state.toggleNav },
    ],
    [p, state.toggleNav]
  );
  return (
    <>
      <div className={cn('app', p.aside && 'aside-open', p.aside && wide && 'aside-wide')}>
        <MobileHeader
          account={p.account}
          unread={p.unread ?? 0}
          onMenu={state.toggleNav}
          onInbox={onInbox}
        />
        <Nav
          rows={p.rows}
          account={p.account}
          version={p.version}
          unread={p.unread ?? 0}
          state={state}
          regionRef={p.regionRef}
          onNavigate={p.onNavigate}
          onInbox={onInbox}
        />
        <button
          className="ib showbtn"
          aria-label="Show sidebar"
          title="Show sidebar"
          onClick={() => state.setNavHidden(false)}
        >
          {navIcon}
        </button>
        <div className="center">
          <div className="sidepane" data-region="side" ref={p.regionRef('side')} hidden />
          <main data-region="main">
            <div className="abar" data-region="actions">
              <span className="ttl">{p.title}</span>
              <div className="agrp" ref={p.regionRef('actions')} />
            </div>
            {p.children}
          </main>
          <section
            className="bottom"
            data-region="bottom"
            aria-label={p.bottom ?? 'Bottom panel'}
            hidden={!p.bottom}
          >
            <Splitter {...BOTTOM_SPLIT} />
            <button
              className="bhead"
              aria-expanded={state.bottomOpen}
              onClick={() => state.setBottomOpen(!state.bottomOpen)}
            >
              <span>{p.bottom}</span>
            </button>
            <div className="logs" ref={p.regionRef('bottom')} />
          </section>
        </div>
        <Aside aside={p.aside} regionRef={p.regionRef} onWide={setWide} />
      </div>
      <button
        className={cn('scrim', state.drawer && 'on')}
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={() => state.setDrawer(false)}
      />
      <CommandList open={state.palette} onOpenChange={state.setPalette} commands={commands} />
      <div className="toasts" role="status" aria-live="polite" data-region="toasts" />
    </>
  );
};
