import { Split, useAppState } from '@agentage/app';

const FILES = ['README.md', 'notes/ideas.md', 'journal/2026-11-16.md'];

export default function Fixture() {
  const [sel, setSel] = useAppState('sel', FILES[0] ?? '');
  return (
    <Split id="tree" init={240} min={180} max={420} label="Resize tree">
      <ul aria-label="Files" className="scroll">
        {FILES.map((f) => (
          <li key={f}>
            <button aria-pressed={f === sel} onClick={() => setSel(f)}>
              {f}
            </button>
          </li>
        ))}
      </ul>
      <div className="scroll">
        <h1>Fixture</h1>
        <p>Open: {sel}</p>
      </div>
    </Split>
  );
}
