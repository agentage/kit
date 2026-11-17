import { IconButton } from '@agentage/design-system/icon-button';
import { Bell, Menu } from 'lucide-react';
import { AccountMenu } from './account-menu.js';
import type { Account } from './frame.types.js';
import { Brand } from './logo.js';

interface Props {
  account: Account;
  version: string;
  unread: number;
  onMenu: () => void;
  onInbox: () => void;
  onPalette: () => void;
  onNavigate: (href: string) => void;
}

// Shown below 760 px instead of the docked nav; the nav opens as a drawer.
export const MobileHeader = ({ account, version, unread, ...on }: Props) => (
  <header className="mh" data-region="mobile-header">
    <IconButton
      className="ib rounded-lg"
      icon={<Menu className="i" aria-hidden="true" />}
      aria-label="Open navigation"
      onClick={on.onMenu}
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
      onClick={on.onInbox}
    />
    <AccountMenu
      account={account}
      version={version}
      compact
      onPalette={on.onPalette}
      onToggleNav={on.onMenu}
      onNavigate={on.onNavigate}
    />
  </header>
);
