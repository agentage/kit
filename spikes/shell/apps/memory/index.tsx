import { useState } from 'react';
import { Region, Split, useAppState } from '@agentage/app';

(window as unknown as { __hooks: Set<unknown> }).__hooks.add(useState);
const files = [
  'README.md',
  'journal/2026-11-09.md',
  'projects/agentage/build-plan.md',
  'notes/ideas.md',
];

const MemoryApp = () => {
  const [sel, setSel] = useAppState('sel', files[0]);
  return (
    <>
      <Region name="actions">
        <span className="ttl">Memory</span>
      </Region>
      <Region name="aside">
        <p data-testid="aside-memory">Selected: {sel}</p>
      </Region>
      <Split id="tree" init={260} min={200} max={420}>
        <div role="tree" aria-label="Files" data-region="tree">
          {files.map((f) => (
            <div
              key={f}
              className="tr"
              role="treeitem"
              aria-selected={f === sel}
              style={{ ['--l' as string]: 1 }}
              onClick={() => setSel(f)}
            >
              <span className="nm">{f}</span>
            </div>
          ))}
        </div>
        <div data-region="content">
          <h1>{sel}</h1>
          <p className="mt-2 text-amber-300">Static content pane of the memory sample.</p>
        </div>
      </Split>
    </>
  );
};

export default MemoryApp;
