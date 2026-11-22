import { Region, useAppHost, useAppShell, useAppState } from '@agentage/app';
import { useEffect, useState } from 'react';

declare const BUILD: string;

const Details = () => {
  const [draft] = useAppState('draft', '');
  return <p>probe details, draft {draft}</p>;
};

export default function Probe() {
  const [draft, setDraft] = useAppState('draft', '');
  const [pong, setPong] = useState('');
  const { notify, openAside, route, setPages, setNavSection, setBottomBar } = useAppShell();
  const { api, user } = useAppHost();
  useEffect(() => {
    setPages([
      { title: 'Probe', path: '' },
      { title: 'Runs', path: 'runs' },
    ]);
    setNavSection({
      title: 'Memories',
      items: ['personal', 'work', 'agentage'].map((n) => ({ title: n, path: n, icon: 'folder' })),
    });
    setBottomBar({ title: 'Probe log', count: 1 });
  }, [setPages, setNavSection, setBottomBar]);
  return (
    <div className="scroll">
      <h1>Probe</h1>
      <p>{`At /${route.path}?${new URLSearchParams(route.query).toString()}`}</p>
      <p>Build {BUILD}</p>
      <p>User {user?.name ?? user?.email ?? 'none'}</p>
      <label>
        Draft <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button
        onClick={() =>
          void api<{ msg: string }>('/echo?msg=hi').then((d) => setPong(`pong ${d.msg}`))
        }
      >
        Ping
      </button>
      <p>{pong}</p>
      <button onClick={() => notify({ text: 'Notified' })}>Notify</button>
      <button onClick={() => notify({ text: 'Saved', kind: 'ok' })}>Say ok</button>
      <button onClick={() => notify({ text: 'Broke', kind: 'error' })}>Say error</button>
      <button onClick={() => openAside('details')}>Details</button>
      <Region name="aside">
        <Details />
      </Region>
    </div>
  );
}
