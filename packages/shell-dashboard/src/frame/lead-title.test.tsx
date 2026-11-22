// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Frame } from './frame.js';
import { createRegionHost } from './regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = async () => {
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <Frame
        rows={[{ id: 'memory', title: 'Memory', href: '/memory', icon: null, current: true }]}
        account={{ label: 'Alex Doe', initials: 'AD' }}
        version="0.1.0"
        title="Memory"
        aside={null}
        regionRef={createRegionHost().ref}
        onNavigate={vi.fn()}
      >
        <p>app</p>
      </Frame>
    )
  );
  return el;
};
const fill = async (el: Element, html: string) => {
  const lead = el.querySelector('.lead')!;
  await act(async () => {
    lead.innerHTML = html;
    await Promise.resolve();
  });
};
const hidden = (el: Element) => el.querySelector('.lgrp')!.hasAttribute('data-lead');

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

describe('the title next to the lead region', () => {
  it('shows the title while lead is empty or holds only visually hidden text', async () => {
    const el = await mount();
    expect(hidden(el)).toBe(false);
    await fill(el, '<span class="sr-only">Memory</span>');
    expect(hidden(el)).toBe(false);
  });

  it('hides the title while lead has visible content and shows it again when lead empties', async () => {
    const el = await mount();
    await fill(el, '<button aria-label="Tree"><svg></svg></button><span>Memories / demo</span>');
    expect(hidden(el)).toBe(true);
    await fill(el, '');
    expect(hidden(el)).toBe(false);
  });

  it('keeps the app title as the name of main and the document title', async () => {
    const el = await mount();
    expect(el.querySelector('main')?.getAttribute('aria-label')).toBe('Memory');
    expect(document.title).toBe('Memory - agentage');
  });
});
