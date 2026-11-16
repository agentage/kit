import { useState } from 'react';
import { Region, useAppHost, useAppShell, useAppState } from '@agentage/app';

const LABEL = 'Probe v0';
(window as unknown as { __hooks: Set<unknown> }).__hooks.add(useState);

const Details = () => {
  const [draft] = useAppState('draft', '');
  const { user } = useAppHost();
  return (
    <p data-testid="aside-probe">
      Probe details for {user.name}: draft is "{draft}"
    </p>
  );
};

const ProbeApp = () => {
  const [draft, setDraft] = useAppState('draft', '');
  const [plain, setPlain] = useState('');
  const { notify } = useAppShell();
  return (
    <div className="scroll">
      <Region name="actions">
        <span className="ttl">Probe</span>
      </Region>
      <h1 data-testid="label">{LABEL}</h1>
      <label>
        state(draft){' '}
        <input data-testid="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <label>
        {' '}
        useState{' '}
        <input data-testid="plain" value={plain} onChange={(e) => setPlain(e.target.value)} />
      </label>
      <button onClick={() => notify({ text: 'hi' })}>Notify</button>
      <Region name="aside">
        <Details />
      </Region>
    </div>
  );
};

export default ProbeApp;
