import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@agentage/design-system/dropdown-menu';
import {
  ChevronUp,
  Command as CommandIcon,
  KeyRound,
  LogOut,
  PanelLeft,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Account } from './frame.types.js';
import { SignInLink } from './sign-in-link.js';

interface Props {
  account: Account;
  version: string;
  apps?: { id: string; version: string }[];
  // The mobile header shows the avatar alone, at the right edge.
  compact?: boolean;
  onPalette: () => void;
  onToggleNav: () => void;
  onNavigate: (href: string) => void;
}

const SIGNED_OUT = 'Not signed in, run agentage setup';
const I = { className: 'i', 'aria-hidden': true } as const;

// A plain element, not a component: the menu's Slot passes its props onto the button.
const trigger = ({ account, version, compact }: Pick<Props, 'account' | 'version' | 'compact'>) =>
  compact ? (
    <button className="av" aria-label="Account menu" title={account.label ?? SIGNED_OUT}>
      {account.initials}
    </button>
  ) : (
    <button
      className={account.pending ? 'acct pending' : 'acct'}
      title={account.label ?? SIGNED_OUT}
      aria-label="Account menu"
    >
      <span className="av" aria-hidden="true">
        {account.initials}
      </span>
      <span className="who">
        {account.label ? (
          <b>{account.label}</b>
        ) : (
          <b>
            Not signed in<span className="sr-only">, run agentage setup</span>
          </b>
        )}
        <span data-shell-version={version}>kit {version}</span>
      </span>
      <ChevronUp {...I} />
    </button>
  );

// Settings, Tokens and Sign out link to the account extension; absent routes hide the item.
const links = (account: Account, go: (href: string) => void): ReactNode[] => {
  const l = account.links ?? {};
  const rows: [string | undefined, string, ReactNode][] = [
    [l.settings, 'Settings', <Settings key="i" {...I} />],
    [l.tokens, 'Tokens', <KeyRound key="i" {...I} />],
    [l.signOut, 'Sign out', <LogOut key="i" {...I} />],
  ];
  return rows
    .filter((r): r is [string, string, ReactNode] => !!r[0])
    .map(([href, label, icon]) => (
      <DropdownMenuItem key={label} onClick={() => go(href)}>
        {icon}
        {label}
      </DropdownMenuItem>
    ));
};

// The account region: who is signed in, the shell version (`kit 0.18.3`), the account links.
export const AccountMenu = ({ account, version, apps = [], compact, ...on }: Props) => {
  if (!account.label && account.signIn)
    return <SignInLink href={account.signIn} version={version} compact={compact} />;
  const items = links(account, on.onNavigate);
  return (
    <DropdownMenu
      side={compact ? 'bottom' : 'top'}
      align={compact ? 'end' : 'start'}
      trigger={trigger({ account, version, compact })}
    >
      <DropdownMenuLabel>{account.label ?? SIGNED_OUT}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>kit {version}</DropdownMenuLabel>
      {apps.map((a) => (
        <DropdownMenuLabel key={a.id}>{`${a.id} ${a.version}`}</DropdownMenuLabel>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={on.onPalette}>
        <CommandIcon {...I} />
        Command list
      </DropdownMenuItem>
      <DropdownMenuItem onClick={on.onToggleNav}>
        <PanelLeft {...I} />
        Toggle sidebar
      </DropdownMenuItem>
      {items.length > 0 && <DropdownMenuSeparator />}
      {items}
    </DropdownMenu>
  );
};
