import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { probeDir } from './probe-dir.mjs';

const made = [];
const checkout = (nested) => {
  const root = mkdtempSync(join(tmpdir(), 'probe-dir-'));
  made.push(root);
  writeFileSync(join(root, 'package.json'), '{}');
  if (nested) {
    mkdirSync(join(root, 'extensions', 'probe'), { recursive: true });
    writeFileSync(join(root, 'extensions', 'probe', 'package.json'), '{}');
  }
  return root;
};

afterEach(() => made.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('probeDir', () => {
  it('takes the repo root when the probe is at the root', () => {
    const root = checkout(false);
    expect(probeDir(root)).toBe(root);
  });

  it('takes extensions/probe when that folder holds the probe', () => {
    const root = checkout(true);
    expect(probeDir(root)).toBe(join(root, 'extensions', 'probe'));
  });

  it('prints the folder when run as a script', () => {
    const root = checkout(true);
    const out = execFileSync('node', ['scripts/probe-dir.mjs', root], { encoding: 'utf8' });
    expect(out.trim()).toBe(join(root, 'extensions', 'probe'));
  });
});
