import { AppContext, Region, useAppHost, useAppShell, useAppState } from '@agentage/app';
import { useContext, useEffect, useState } from 'react';
import type { Discovery } from '../host/host.types.js';

export const Probe = () => {
  const [draft, setDraft] = useAppState('draft', '');
  const [plain, setPlain] = useState('');
  const [pong, setPong] = useState('');
  const { notify, openAside, route, setPages, setBottomBar } = useAppShell();
  const { api, user } = useAppHost();
  const raw = useContext(AppContext)?.host;
  useEffect(() => {
    setPages([
      { title: 'Probe one', path: '' },
      { title: 'Runs', path: 'runs' },
    ]);
    setBottomBar({ title: 'Probe log', count: 2 });
  }, [setPages, setBottomBar]);
  return (
    <div>
      <h1>Probe one</h1>
      <p>{`At /${route.path}?${new URLSearchParams(route.query).toString()}`}</p>
      <p>User {user?.name ?? user?.email ?? 'none'}</p>
      <input aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <input aria-label="Plain" value={plain} onChange={(e) => setPlain(e.target.value)} />
      <button onClick={() => void api<{ url: string }>('/echo').then((d) => setPong(d.url))}>
        Ping
      </button>
      <output>{pong}</output>
      <button onClick={() => notify({ text: 'Notified' })}>Notify</button>
      <button onClick={() => notify({ text: 'Failed', kind: 'error' })}>Fail</button>
      <button onClick={() => void raw?.request('fixture', '/secret', {})}>Sneak</button>
      <button onClick={() => openAside('details')}>Details</button>
      <Region name="aside">
        <p>probe details</p>
      </Region>
    </div>
  );
};
export const ProbeTwo = () => {
  const [draft] = useAppState('draft', '');
  return <h1>Probe two {draft}</h1>;
};
export const Fixture = () => <h1>Fixture</h1>;
export const Throws = (): React.ReactNode => {
  throw new Error('lab app throws');
};

const app = (id: string, title: string, order: number, icon?: string) => ({
  id,
  version: '0.1.0',
  app: { title, order, icon, entry: `/app/${id}/app-1.js`, css: `/app/${id}/app-1.css` },
});
export const DOC: Discovery = {
  host: 'local',
  shell: { package: '@agentage/shell-dashboard', version: '0.1.0' },
  extensions: [
    app('fixture', 'Fixture', 20, 'box'),
    app('probe', 'Probe', 10, 'radar'),
    app('throws', 'Throws', 30, 'bomb'),
    { id: 'plain', version: '1.0.0' },
  ],
};
