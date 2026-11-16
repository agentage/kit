import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type Child, type Exit, type Launch } from '../host/daemon/child.js';
import { json, tempPackage } from './packages.js';

// A folder row with no store or secret: dist/word.txt is what its child answers.
export const wordPackage = (word: string, id = 'word') =>
  tempPackage({
    'package.json': json({
      name: `@agentage/extension-${id}`,
      version: '1.0.0',
      type: 'module',
      engines: { agentage: '^0.14' },
      agentage: { id, parts: { api: true } },
    }),
    'dist/api/index.js': 'export const create = () => (_req, _res, next) => next();\n',
    'dist/word.txt': word,
  });

export interface WordChild extends Child {
  // Ends the child as a crash would: the daemon sees an exit it did not ask for.
  crash(words?: string): void;
}

export interface WordLaunch {
  launch: Launch;
  children: WordChild[];
  // 'start <n>', 'exit <n>' in the order they happened.
  events: string[];
}

// Each start reads dist/word.txt again (a fork would, an import cache would not); "throw" fails it.
// exitMs: a child takes that long to exit after stop, like a store that drains.
export const wordLaunch = (exitMs = 0): WordLaunch => {
  const children: WordChild[] = [];
  const events: string[] = [];
  const launch: Launch = async (spec) => {
    const word = await readFile(join(spec.dir, 'dist', 'word.txt'), 'utf8');
    if (word === 'throw') throw new Error('fails at start');
    const pid = 1000 + children.length;
    let done = (_how: Exit) => undefined as void;
    const exited = new Promise<Exit>((resolve) => (done = resolve));
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, data: { word, pid } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    let ended = false;
    const end = (how: Exit) => {
      if (ended) return;
      ended = true;
      server.closeAllConnections();
      server.close(() => (events.push(`exit ${pid}`), done(how)));
    };
    const stop = async () => {
      setTimeout(() => end({ code: 0, signal: null }), exitMs);
      await exited;
    };
    const crash = (words = 'boom') => end({ code: 1, signal: null, words });
    const { port } = server.address() as AddressInfo;
    const child = { port, pid, exited, stop, crash };
    events.push(`start ${pid}`);
    children.push(child);
    return child;
  };
  return { launch, children, events };
};
