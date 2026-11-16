import { Bell, PanelBottom, PanelLeft, PanelRight } from 'lucide-react';
import { createElement } from 'react';
import type { FrameProps } from './frame.js';
import type { Command } from './frame.types.js';
import type { FrameState } from './use-frame-state.js';

const icon = (I: typeof Bell) => createElement(I, { className: 'i', 'aria-hidden': true });

// Ctrl+K (K13): go to each app, then the frame's own toggles; a toggle shows only when it applies.
export const frameCommands = (p: FrameProps, state: FrameState): Command[] => {
  const go = p.rows.map((r) => ({
    id: `go-${r.id}`,
    label: `Go to ${r.title}`,
    icon: r.icon,
    run: () => p.onNavigate(r.href),
  }));
  const toggles: (Command | false)[] = [
    !!p.onInbox && { id: 'inbox', label: 'Open inbox', icon: icon(Bell), run: p.onInbox },
    { id: 'toggle-nav', label: 'Toggle sidebar', icon: icon(PanelLeft), run: state.toggleNav },
    !!p.bottom && {
      id: 'toggle-bottom',
      label: 'Toggle bottom panel',
      icon: icon(PanelBottom),
      run: () => state.setBottomOpen(!state.bottomOpen),
    },
    !!p.onDetails && {
      id: 'toggle-details',
      label: 'Toggle details',
      icon: icon(PanelRight),
      run: p.onDetails,
    },
  ];
  return [...go, ...toggles.filter((c): c is Command => !!c)];
};
