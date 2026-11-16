import { IconButton } from '@agentage/design-system/icon-button';
import { Bell, Menu } from 'lucide-react';
import type { Account } from './frame.types.js';
import { Brand } from './logo.js';

interface Props {
  account: Account;
  unread: number;
  onMenu: () => void;
  onInbox: () => void;
}

// Shown below 760 px instead of the docked nav; the nav opens as a drawer.
export const MobileHeader = ({ account, unread, onMenu, onInbox }: Props) => (
  <header className="mh" data-region="mobile-header">
    <IconButton
      className="ib rounded-lg"
      icon={<Menu className="i" aria-hidden="true" />}
      aria-label="Open navigation"
      onClick={onMenu}
    />
    <Brand />
    <IconButton
      className="ib rounded-lg"
      icon={
        <span className="bellwrap">
          <Bell className="i" aria-hidden="true" />
          <span className={unread ? 'dot on' : 'dot'} />
        </span>
      }
      aria-label="Inbox"
      onClick={onInbox}
    />
    <span className="av" title={account.label ?? 'Not signed in'} aria-hidden="true">
      {account.initials}
    </span>
  </header>
);
