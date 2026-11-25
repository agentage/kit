import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@agentage/components/dropdown-menu';
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
        <span data-shell-version={version}>shell {version}</span>
      </span>
      <ChevronUp {...I} />
    </button>
  );

// The library label is a small uppercase heading; a name and versions keep their own case.
const Row = ({ children }: { children: ReactNode }) => (
  <div className="px-2.5 py-1.5 text-xs font-semibold text-muted-foreground" data-slot="menu-row">
    {children}
  </div>
);

// Settings, Tokens and Sign out link to the account extension; absent routes hide the item.
const links = (account: Account, go: (href: string) => void): ReactNode[] => {
  const l = account.links ?? {};
  const to = (href?: string) => (href ? () => go(href) : undefined);
  const rows: [(() => void) | undefined, string, ReactNode][] = [
    [to(l.settings), 'Settings', <Settings key="i" {...I} />],
    [to(l.tokens), 'Tokens', <KeyRound key="i" {...I} />],
    [account.onSignOut ?? to(l.signOut), 'Sign out', <LogOut key="i" {...I} />],
  ];
  return rows
    .filter((r): r is [() => void, string, ReactNode] => !!r[0])
    .map(([run, label, icon]) => (
      <DropdownMenuItem key={label} onClick={run}>
        {icon}
        {label}
      </DropdownMenuItem>
    ));
};

// The account region: who is signed in, the shell version (`shell 0.3.0`), the account links.
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
      <Row>{account.label ?? SIGNED_OUT}</Row>
      <DropdownMenuSeparator />
      <Row>shell {version}</Row>
      {apps.map((a) => (
        <Row key={a.id}>{`${a.id} ${a.version}`}</Row>
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
