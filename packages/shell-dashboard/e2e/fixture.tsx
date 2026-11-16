// The frame filled like shell-samples/index.html, to compare screenshots beside the prototype.
import {
  AppContext,
  createStateStore,
  Region,
  type AppContextValue,
  type HostAdapter,
} from '@agentage/app';
import { Archive, Box, House, List, Puzzle, Server, Users } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { Frame } from '../src/frame/frame.js';
import { createRegionHost } from '../src/frame/regions.js';
import { Actions, Overview } from './fixture-overview.js';

const ICON = { className: 'i', 'aria-hidden': true } as const;
const ROWS = [
  ['overview', 'Overview', <House key="i" {...ICON} />],
  ['extensions', 'Extensions', <Puzzle key="i" {...ICON} />],
  ['hosts', 'Hosts', <Server key="i" {...ICON} />],
  ['logs', 'Logs', <List key="i" {...ICON} />],
  ['backups', 'Backups', <Archive key="i" {...ICON} />],
  ['users', 'Users', <Users key="i" {...ICON} />],
  ['installations', 'Installations', <Box key="i" {...ICON} />],
] as const;

const regions = createRegionHost();
const host: HostAdapter = { user: null, scopes: [], request: (_i, p) => fetch(p) };
const ctx: AppContextValue = {
  id: 'overview',
  route: { path: '', query: {} },
  regions,
  host,
  store: createStateStore(),
  shell: {
    notify: () => undefined,
    openAside: () => undefined,
    closeAside: () => undefined,
    navigate: () => undefined,
  },
};
const wide = new URLSearchParams(location.search).has('aside');

createRoot(document.getElementById('root')!).render(
  <Frame
    rows={ROWS.map(([id, title, icon]) => ({
      id,
      title,
      icon,
      href: `/${id}`,
      current: id === 'overview',
    }))}
    account={{ label: 'Alex Doe', initials: 'AD' }}
    version="0.1.0"
    title="Overview"
    unread={3}
    aside={wide ? { title: 'memory', onClose: () => undefined } : null}
    regionRef={regions.ref}
    onNavigate={() => undefined}
  >
    <AppContext.Provider value={ctx}>
      <Region name="actions">
        <Actions />
      </Region>
      <Overview />
    </AppContext.Provider>
  </Frame>
);
