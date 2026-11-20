import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installProblems } from '../check-install.mjs';

const dockerfile = readFileSync('packages/apphost/Dockerfile', 'utf8');
const ignore = readFileSync('packages/apphost/Dockerfile.dockerignore', 'utf8').split('\n');

describe('the app host image', () => {
  it('has the cloud entry, no command, user node, health on 127.0.0.1, no local flag', () => {
    expect(dockerfile).toMatch(
      /^ENTRYPOINT \["\/app\/node_modules\/\.bin\/agentage-apphost-cloud"\]$/m
    );
    expect(dockerfile).not.toMatch(/^CMD /m);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK .*http:\/\/127\.0\.0\.1:/m);
    expect(dockerfile).not.toMatch(/STUB_LOOPBACK_HTTP/);
  });

  it('builds from this tree with the lockfile, checks the install, takes COMMIT_SHA and BUILD_TIME', () => {
    expect(dockerfile).toMatch(/^FROM node:26-alpine AS build$/m);
    expect(dockerfile).toMatch(/^COPY \. \.$/m);
    expect(dockerfile).toMatch(
      /npm ci --omit=dev --omit=peer --omit=optional .*-w @agentage\/apphost$/m
    );
    expect(dockerfile).toMatch(/^RUN node packages\/apphost\/check-install\.mjs \/src$/m);
    expect(dockerfile).not.toMatch(/npm install/);
    expect(dockerfile).toMatch(/^ARG COMMIT_SHA=unknown$/m);
    expect(dockerfile).toMatch(/^ARG BUILD_TIME=unknown$/m);
    expect(dockerfile).toMatch(/COMMIT_SHA=\$COMMIT_SHA BUILD_TIME=\$BUILD_TIME/);
  });

  it('keeps a local install and build out of the context', () => {
    for (const line of ['.git', '**/node_modules', '**/dist', '**/*.tsbuildinfo'])
      expect(ignore).toContain(line);
  });
});

// A built tree: workspace packages linked from node_modules, the bin, and `extra` real folders.
const tree = (extra) => {
  const root = mkdtempSync(join(tmpdir(), 'apphost-tree-'));
  for (const name of ['extension', 'apphost']) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    const pkg = { name: `@agentage/${name}` };
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify(pkg));
  }
  mkdirSync(join(root, 'node_modules/@agentage'), { recursive: true });
  mkdirSync(join(root, 'node_modules/.bin'));
  writeFileSync(join(root, 'node_modules/.bin/agentage-apphost-cloud'), '');
  for (const name of ['extension', 'apphost'])
    symlinkSync(join(root, 'packages', name), join(root, 'node_modules/@agentage', name));
  for (const path of extra) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, 'package.json'), '{}');
  }
  return root;
};

describe('the build check', () => {
  it('passes one linked kit; a second copy in a workspace or under a scoped package fails', () => {
    expect(installProblems(tree([]))).toEqual([]);
    const copies = [
      'packages/apphost/node_modules/@agentage/extension',
      'node_modules/@scope/x/node_modules/@agentage/extension',
    ];
    for (const copy of copies) {
      const problems = installProblems(tree([copy]));
      expect(problems.some((p) => /^2 copies of @agentage\/extension, not 1: /.test(p))).toBe(true);
    }
  });

  it('fails a workspace package that came from npm, a missing bin and a missing shell page', () => {
    const root = tree(['node_modules/@agentage/logs']);
    mkdirSync(join(root, 'packages/logs'));
    writeFileSync(join(root, 'packages/logs/package.json'), '{"name":"@agentage/logs"}');
    const shell = {
      name: '@agentage/apphost',
      dependencies: { '@agentage/shell-dashboard': '1.0.0' },
    };
    writeFileSync(join(root, 'packages/apphost/package.json'), JSON.stringify(shell));
    rmSync(join(root, 'node_modules/.bin/agentage-apphost-cloud'));
    const problems = installProblems(root);
    expect(problems).toContain(
      `${join(root, 'node_modules/@agentage/logs')}: not a workspace link`
    );
    expect(problems).toContain('no shell page (dist/index.html)');
    expect(problems).toContain('no agentage-apphost-cloud bin');
  });
});
