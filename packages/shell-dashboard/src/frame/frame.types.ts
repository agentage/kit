import type { ReactNode } from 'react';

export interface NavRow {
  id: string;
  title: string;
  href: string;
  icon: ReactNode;
  current?: boolean;
}

export interface Account {
  // The name, else the email; null when signed out.
  label: string | null;
  initials: string;
  // Routes of the account extension; a missing one hides its menu item.
  links?: { settings?: string; tokens?: string; signOut?: string };
}

export interface AsideState {
  title: string;
  // Called by the close button and Escape.
  onClose: () => void;
}

export interface Command {
  id: string;
  label: string;
  icon?: ReactNode;
  run: () => void;
}

// One page of the open app, listed in the title menu of the actions bar.
export interface PageItem {
  title: string;
  href: string;
  current?: boolean;
}

// The bottom slot bar: the title and count the app gives; the shell adds no content.
export interface BottomState {
  title: string;
  count?: number;
}
