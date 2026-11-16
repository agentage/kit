import { json, tempPackage } from './packages.js';

// A package with a git store (G5, G6): its api commits a file under ctx.store.gitRoot with ctx.store.git.
export const GIT_MANIFEST = {
  name: '@agentage/extension-gitter',
  version: '0.1.0',
  type: 'module',
  engines: { agentage: '^0.16' },
  agentage: { id: 'gitter', parts: { api: true, store: 'git' } },
};

// The same code with no store: its child gets no child-process grant.
export const NO_GIT_MANIFEST = {
  ...GIT_MANIFEST,
  agentage: { id: 'nogit', parts: { api: true } },
};

// POST: init (once), commit n.txt, push to ?remote=; GET ?path=: the code of a node:fs read.
const API = `export const create = (ctx) => (req, res) => {
  const { execFileSync } = process.getBuiltinModule('node:child_process');
  const fs = process.getBuiltinModule('node:fs');
  const url = new URL(req.url, 'http://x');
  const root = ctx.extension.store ? ctx.store.gitRoot : '/nowhere';
  if (req.method === 'GET') {
    try { fs.readFileSync(url.searchParams.get('path')); return res.json({ success: true, data: { code: 'OK' } }); }
    catch (err) { return res.json({ success: true, data: { code: err.code ?? 'ERROR' } }); }
  }
  const who = { GIT_AUTHOR_NAME: 'k', GIT_AUTHOR_EMAIL: 'k@x', GIT_COMMITTER_NAME: 'k', GIT_COMMITTER_EMAIL: 'k@x' };
  const access = ctx.extension.store ? ctx.store.git : undefined;
  const env = { ...(access?.env ?? { PATH: process.env.PATH }), ...who };
  const cwd = access?.cwd;
  const git = (...args) => execFileSync('git', ['-C', root + '/u1/default', ...args], { cwd, env, encoding: 'utf8' }).trim();
  try {
    execFileSync('git', ['--version'], { env });
    fs.mkdirSync(root + '/u1/default', { recursive: true });
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(root + '/u1/default/n.txt', String(Date.now()));
    git('add', 'n.txt');
    git('commit', '-q', '-m', 'n');
    const remote = url.searchParams.get('remote');
    if (remote) git('push', '-q', remote, 'main:refs/vaults/u1/default/main');
    res.json({ success: true, data: { sha: git('rev-parse', 'HEAD'), root, remote: Boolean(access?.remote) } });
  } catch (err) {
    res.json({ success: true, data: { code: err.code ?? 'ERROR' } });
  }
};
`;

export const gitPackage = (manifest: object = GIT_MANIFEST) =>
  tempPackage({ 'package.json': json(manifest), 'dist/api/index.js': API });
