import type { RegionName } from '@agentage/app';
import { ChevronUp, PanelLeft } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Aside } from './aside.js';
import { CommandList } from './command-list.js';
import { frameCommands } from './commands.js';
import type {
  Account,
  AsideState,
  BottomState,
  NavRow,
  NavSectionView,
  PageItem,
} from './frame.types.js';
import { MobileHeader } from './mobile-header.js';
import { Nav } from './nav.js';
import { useLeadWatch } from './use-lead-watch.js';
import { SidePane } from './side-pane.js';
import { BOTTOM_SPLIT, Splitter } from './splitter.js';
import { TitleMenu } from './title-menu.js';
import { useFrameState } from './use-frame-state.js';
import { usePeek } from './use-peek.js';

export interface FrameProps {
  rows: NavRow[];
  account: Account;
  version: string;
  // The title in the actions bar (the open app's title).
  title: string;
  // The open app's pages: the title becomes a menu ("Overview ⌄").
  pages?: PageItem[];
  // The open app's titled nav list, below the app rows.
  section?: NavSectionView | null;
  aside: AsideState | null;
  unread?: number;
  // The bottom region shows only when an app fills it (S1.4.1); closed by default.
  bottom?: BottomState | null;
  // The installed apps and versions, listed in the account menu.
  apps?: { id: string; version: string }[];
  regionRef: (name: RegionName) => (el: HTMLElement | null) => void;
  onNavigate: (href: string) => void;
  onInbox?: () => void;
  // The open app has a details aside: the command list gets "Toggle details".
  onDetails?: () => void;
  children: ReactNode;
}

const navIcon = <PanelLeft className="i" aria-hidden="true" />;

// Escape closes the aside last: after the command list, a menu (it prevents) and the drawer.
const useAsideEscape = (aside: AsideState | null, busy: boolean) =>
  useEffect(() => {
    if (!aside || busy) return;
    const onKey = (e: KeyboardEvent) => {
      const inPopup = (e.target as Element | null)?.closest?.('[role="menu"], [role="dialog"]');
      if (e.key === 'Escape' && !e.defaultPrevented && !inPopup) aside.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [aside, busy]);

// The frame of shell-samples/index.html (variant B): nav, main with actions, bottom, aside.
export const Frame = (p: FrameProps) => {
  const state = useFrameState();
  const peek = usePeek(state.navHidden);
  const [wide, setWide] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  useLeadWatch(group);
  useEffect(() => void (document.title = `${p.title} - agentage`), [p.title]);
  const onInbox = p.onInbox ?? (() => undefined);
  const commands = frameCommands(p, state);
  useAsideEscape(p.aside, state.palette || state.drawer);
  return (
    <>
      <div className={cn('app', p.aside && 'aside-open', p.aside && wide && 'aside-wide')}>
        <MobileHeader
          account={p.account}
          version={p.version}
          apps={p.apps ?? []}
          unread={p.unread ?? 0}
          onMenu={state.toggleNav}
          onInbox={onInbox}
          onPalette={() => state.setPalette(true)}
          onNavigate={p.onNavigate}
        />
        <Nav
          rows={p.rows}
          section={p.section ?? null}
          account={p.account}
          version={p.version}
          apps={p.apps ?? []}
          unread={p.unread ?? 0}
          state={state}
          peek={peek}
          regionRef={p.regionRef}
          onNavigate={p.onNavigate}
          onInbox={onInbox}
        />
        <button
          className="ib showbtn"
          id="show"
          aria-label="Show sidebar"
          title="Show sidebar"
          onClick={() => state.setNavHidden(false)}
          {...peek.handlers}
        >
          {navIcon}
        </button>
        <div className="center">
          <div className="abar" data-region="actions">
            <div className="lgrp" ref={group}>
              <div className="lead" data-region="lead" ref={p.regionRef('lead')} />
              <TitleMenu title={p.title} pages={p.pages ?? []} onNavigate={p.onNavigate} />
            </div>
            <div className="agrp" ref={p.regionRef('actions')} />
          </div>
          {/* The bar spans side and main (frame.html), so a side pane that opens moves no bar. */}
          <div className="split">
            <SidePane regionRef={p.regionRef} />
            <main data-region="main" aria-label={p.title}>
              {p.children}
            </main>
          </div>
          <section
            className="bottom"
            data-region="bottom"
            aria-label={p.bottom?.title ?? 'Bottom panel'}
            hidden={!p.bottom}
          >
            <Splitter {...BOTTOM_SPLIT} />
            <button
              className="bhead"
              aria-expanded={state.bottomOpen}
              onClick={() => state.setBottomOpen(!state.bottomOpen)}
            >
              <span>{p.bottom?.title}</span>
              {!!p.bottom?.count && <span className="err">{p.bottom.count}</span>}
              <span className="sp" />
              <ChevronUp className="i" aria-hidden="true" />
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
    </>
  );
};
