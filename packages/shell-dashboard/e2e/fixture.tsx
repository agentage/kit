// The frame (chrome only) with rows as discovery gives them, to compare beside the prototype.
import { Box, Brain, Cloud, List, Store } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { Frame } from '../src/frame/frame.js';
import { createRegionHost } from '../src/frame/regions.js';
import { shellVersion } from '../src/version.js';

const ICON = { className: 'i', 'aria-hidden': true } as const;
// One row per installed extension with `agentage.app`; the shell has no rows of its own.
const ROWS = [
  ['platform', 'Platform', <Box key="i" {...ICON} />],
  ['memory', 'Memory', <Brain key="i" {...ICON} />],
  ['logs', 'Logs', <List key="i" {...ICON} />],
  ['market', 'Market', <Store key="i" {...ICON} />],
  ['cloud', 'Cloud', <Cloud key="i" {...ICON} />],
] as const;
// The open app (platform) fills the title menu and the bottom bar; main stays empty.
const PAGES = ['Overview', 'Last 24 h', 'Last 7 d'].map((title, i) => ({
  title,
  href: `/platform/${i}`,
  current: i === 0,
}));

const regions = createRegionHost();
const params = new URLSearchParams(location.search);
const go = (href: string) => history.pushState(null, '', href);

createRoot(document.getElementById('root')!).render(
  <Frame
    rows={ROWS.map(([id, title, icon]) => ({
      id,
      title,
      icon,
      href: `/${id}`,
      current: id === 'platform',
    }))}
    account={{ label: 'Alex Doe', initials: 'AD' }}
    version={shellVersion()}
    title="Overview"
    pages={PAGES}
    unread={3}
    bottom={{ title: 'Log tail', count: 2 }}
    aside={params.has('aside') ? { title: 'Details', onClose: () => go('/fixture.html') } : null}
    regionRef={regions.ref}
    onNavigate={go}
    onInbox={() => undefined}
    onDetails={() => undefined}
  >
    <div className="scroll" data-page="platform" />
  </Frame>
);
