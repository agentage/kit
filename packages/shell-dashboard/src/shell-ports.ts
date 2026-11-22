import type { ShellPort } from '@agentage/app';
import type { AppBarsStore } from './chrome/app-bars.js';
import type { Notices } from './notices/notices.js';
import { navigate, setAside } from './route/router.js';

// One stable port per app id, so an app's context does not change on a shell render.
export const createPorts = (notices: Notices, bars: AppBarsStore) => {
  const ports = new Map<string, ShellPort>();
  return (id: string): ShellPort => {
    const known = ports.get(id);
    if (known) return known;
    const port: ShellPort = {
      notify: (n) => notices.push(id, n),
      openAside: (key) => setAside(key),
      closeAside: () => setAside(null),
      navigate: (page) => navigate(`/${id}/${page.replace(/^\/+/, '')}`),
      setPages: (pages) => bars.setPages(id, pages),
      setNavSection: (section) => bars.setSection(id, section),
      setBottomBar: (bar) => bars.setBottom(id, bar),
    };
    ports.set(id, port);
    return port;
  };
};

// "Alex Doe" -> AD, "lab@example.test" -> LA; "?" signed out.
export const initials = (label: string | null): string => {
  if (!label) return '?';
  const words = label
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const two = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '?').slice(0, 2);
  return two.toUpperCase();
};
