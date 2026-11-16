import { createRoot } from 'react-dom/client';
import type { ShellDeps } from './host/host.types.js';
import { ShellApp } from './shell-app.js';
import { shellVersion } from './version.js';

const deps: ShellDeps = {
  fetch: (input, init) => fetch(input, init),
  events: (url) => new EventSource(url),
  importModule: (url) => import(/* @vite-ignore */ url) as Promise<{ default?: unknown }>,
};

const root = document.getElementById('root');
if (root) createRoot(root).render(<ShellApp deps={deps} version={shellVersion()} />);
