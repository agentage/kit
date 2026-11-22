// @vitest-environment jsdom
import type { ShellPort } from '@agentage/app';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createRegionHost } from '../frame/regions.js';
import { AppRoot } from './app-root.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('AppRoot', () => {
  it('clears the nav section of its app when it unmounts', async () => {
    const setNavSection = vi.fn();
    const shell = { setNavSection } as unknown as ShellPort;
    const root = createRoot(document.createElement('div'));
    await act(async () =>
      root.render(
        <AppRoot
          id="memory"
          title="Memory"
          entry="/app/memory/a.js"
          App={() => null}
          host={{} as never}
          shell={shell}
          route={{ path: '', query: {} }}
          store={{} as never}
          regions={createRegionHost()}
        />
      )
    );
    expect(setNavSection).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(setNavSection).toHaveBeenCalledWith(null);
  });
});
