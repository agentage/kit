import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@agentage/design-system/dropdown-menu';
import { ChevronUp, Command as CommandIcon, PanelLeft } from 'lucide-react';
import type { Account } from './frame.types.js';

interface Props {
  account: Account;
  version: string;
  onPalette: () => void;
  onToggleNav: () => void;
}

const SIGNED_OUT = 'Not signed in, run agentage setup';

// The account region: who is signed in and the shell version (`shell 0.1.0`).
export const AccountMenu = ({ account, version, onPalette, onToggleNav }: Props) => (
  <DropdownMenu
    side="top"
    align="start"
    trigger={
      <button className="acct" title={account.label ?? SIGNED_OUT} aria-label="Account menu">
        <span className="av" aria-hidden="true">
          {account.initials}
        </span>
        <span className="who">
          <b>{account.label ?? 'Not signed in'}</b>
          <span data-shell-version={version}>shell {version}</span>
        </span>
        <ChevronUp className="i" aria-hidden="true" />
      </button>
    }
  >
    <DropdownMenuLabel>{account.label ?? SIGNED_OUT}</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={onPalette}>
      <CommandIcon className="i" aria-hidden="true" />
      Command list
    </DropdownMenuItem>
    <DropdownMenuItem onClick={onToggleNav}>
      <PanelLeft className="i" aria-hidden="true" />
      Toggle sidebar
    </DropdownMenuItem>
  </DropdownMenu>
);
