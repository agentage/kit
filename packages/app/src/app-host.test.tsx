// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppHost } from './app.types.js';
import { useAppHost } from './index.js';
import { TestHost } from './test-host.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

const read = async (props: Partial<Parameters<typeof TestHost>[0]> = {}) => {
  let seen: AppHost | undefined;
  const Probe = () => {
    seen = useAppHost();
    return null;
  };
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () =>
    root?.render(
      <TestHost id="probe" {...props}>
        <Probe />
      </TestHost>
    )
  );
  return seen!;
};

describe('useAppHost C7', () => {
  it('gives extension { id, version } and host { kind, url } of the adapter', async () => {
    const at = { kind: 'cloud', url: 'https://probe.next.agentage.io' } as const;
    const host = await read({ version: '0.9.0', at });
    expect(host.extension).toEqual({ id: 'probe', version: '0.9.0' });
    expect(host.host).toEqual(at);
  });

  it('the test host defaults to a local host', async () => {
    const host = await read();
    expect(host.host.kind).toBe('local');
    expect(host.extension.version).toBe('0.0.0');
  });
});
