import type { NavRow } from '../frame/frame.types.js';
import type { Discovery, ExtensionRow } from '../host/host.types.js';
import { AppIcon } from './app-icon.js';

export type AppExtension = ExtensionRow & { app: NonNullable<ExtensionRow['app']> };

// The rows with an app, by `agentage.app.order`, then title.
export const appRows = (doc: Discovery | null): AppExtension[] =>
  (doc?.extensions ?? [])
    .filter((x): x is AppExtension => !!x.app)
    .sort(
      (a, b) =>
        (a.app.order ?? 1000) - (b.app.order ?? 1000) || a.app.title.localeCompare(b.app.title)
    );

export const navRowsOf = (rows: AppExtension[], current: string): NavRow[] =>
  rows.map((x) => ({
    id: x.id,
    title: x.app.title,
    href: `/${x.id}`,
    current: x.id === current,
    icon: <AppIcon name={x.app.icon} />,
  }));
