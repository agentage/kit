// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useAppShell } from './context.js';
import { createTestRecord, TestHost } from './test-host.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('setPages and setBottomBar', () => {
  it('reach the shell through useAppShell', async () => {
    const record = createTestRecord();
    const App = () => {
      const { setPages, setBottomBar } = useAppShell();
      useEffect(() => {
        setPages([{ title: 'Files', path: '' }]);
        setBottomBar({ title: 'Activity', count: 2 });
      }, [setPages, setBottomBar]);
      return null;
    };
    const root = createRoot(document.createElement('div'));
    await act(async () =>
      root.render(
        <TestHost id="memory" record={record}>
          <App />
        </TestHost>
      )
    );
    expect(record.pageLinks).toEqual([{ title: 'Files', path: '' }]);
    expect(record.bottomBar).toEqual({ title: 'Activity', count: 2 });
    act(() => root.unmount());
  });
});
