import { describe, expect, it } from 'vitest';
import { lastWords } from './child.js';

// Real stderr of an uncaught error, captured on Node 24.6.0 and 22.23.2 (paths shortened).
const SAMPLES: [string, string, string][] = [
  [
    'Node 24 plain',
    "file:///x/plain.mjs:1\nthrow new Error('plain boom');\n      ^\n\nError: plain boom\n    at file:///x/plain.mjs:1:7\n    at ModuleJob.run (node:internal/modules/esm/module_job:371:25)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:669:26)\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)\n\nNode.js v24.6.0\n",
    'plain boom',
  ],
  [
    'Node 24 props',
    "file:///x/props.mjs:1\nthrow Object.assign(new Error('with props'), { code: 'E_PROPS', detail: 'x' });\n                    ^\n\nError: with props\n    at file:///x/props.mjs:1:21\n    at ModuleJob.run (node:internal/modules/esm/module_job:371:25)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:669:26)\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {\n  code: 'E_PROPS',\n  detail: 'x'\n}\n\nNode.js v24.6.0\n",
    'with props',
  ],
  [
    'Node 24 syntax',
    "file:///x/syntax.mjs:1\nconst = 1;\n      ^\n\nSyntaxError: Unexpected token '='\n    at compileSourceTextModule (node:internal/modules/esm/utils:357:16)\n    at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:108:18)\n    at #translate (node:internal/modules/esm/loader:550:12)\n    at ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:597:27)\n    at async #link (node:internal/modules/esm/module_job:180:19)\n\nNode.js v24.6.0\n",
    "Unexpected token '='",
  ],
  [
    'Node 24 reject',
    "file:///x/reject.mjs:1\nPromise.reject(new TypeError('rejected here'));\n               ^\n\nTypeError: rejected here\n    at file:///x/reject.mjs:1:16\n    at ModuleJob.run (node:internal/modules/esm/module_job:371:25)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:669:26)\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)\n\nNode.js v24.6.0\n",
    'rejected here',
  ],
  [
    'Node 24 str',
    '\nnode:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\na thrown string\n(Use `node --trace-uncaught ...` to show where the exception was thrown)\n\nNode.js v24.6.0\n',
    'a thrown string',
  ],
  [
    'Node 22 plain',
    "file:///x/plain.mjs:1\nthrow new Error('plain boom');\n      ^\n\nError: plain boom\n    at file:///x/plain.mjs:1:7\n    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)\n\nNode.js v22.23.2\n",
    'plain boom',
  ],
  [
    'Node 22 props',
    "file:///x/props.mjs:1\nthrow Object.assign(new Error('with props'), { code: 'E_PROPS', detail: 'x' });\n                    ^\n\nError: with props\n    at file:///x/props.mjs:1:21\n    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {\n  code: 'E_PROPS',\n  detail: 'x'\n}\n\nNode.js v22.23.2\n",
    'with props',
  ],
  [
    'Node 22 syntax',
    "file:///x/syntax.mjs:1\nconst = 1;\n      ^\n\nSyntaxError: Unexpected token '='\n    at compileSourceTextModule (node:internal/modules/esm/utils:346:16)\n    at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:110:18)\n    at #translate (node:internal/modules/esm/loader:559:20)\n    at afterLoad (node:internal/modules/esm/loader:612:29)\n    at ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:617:12)\n    at #createModuleJob (node:internal/modules/esm/loader:640:36)\n    at #getJobFromResolveResult (node:internal/modules/esm/loader:353:34)\n    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:321:41)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:680:25)\n\nNode.js v22.23.2\n",
    "Unexpected token '='",
  ],
  [
    'Node 22 reject',
    "file:///x/reject.mjs:1\nPromise.reject(new TypeError('rejected here'));\n               ^\n\nTypeError: rejected here\n    at file:///x/reject.mjs:1:16\n    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)\n\nNode.js v22.23.2\n",
    'rejected here',
  ],
  [
    'Node 22 str',
    '\nnode:internal/modules/run_main:123\n    triggerUncaughtException(\n    ^\na thrown string\n(Use `node --trace-uncaught ...` to show where the exception was thrown)\n\nNode.js v22.23.2\n',
    'a thrown string',
  ],
];

const exit = { code: 1, signal: null };

describe('lastWords: why a child exited, from its stderr', () => {
  it.each(SAMPLES)('%s', (_name, stderr, words) => expect(lastWords(stderr, exit)).toBe(words));

  it('a log row of error level gives its msg; rows below error are skipped', () => {
    const rows = [
      '{"level":"error","msg":"Error: data/probe is open in process 7"}',
      '{"level":"info","msg":"listening"}',
      '{"level":"warn","msg":"slow"}',
    ].join('\n');
    expect(lastWords(rows, exit)).toBe('data/probe is open in process 7');
  });

  it('an error with a code in brackets, and nothing said at all', () => {
    expect(lastWords('TypeError [ERR_X]: bad thing\n', exit)).toBe('bad thing');
    expect(lastWords('\n\nNode.js v24.6.0\n', { code: null, signal: 'SIGKILL' })).toBe(
      'exited with signal SIGKILL'
    );
  });
});
