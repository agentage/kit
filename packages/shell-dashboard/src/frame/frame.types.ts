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
