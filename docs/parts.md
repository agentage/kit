# Write the parts

Each part of an extension package exports only `create(ctx)`. The kit owns servers, ports,
`/health`, discovery, the envelope, the store connection, the scheduler and argument parsing. The
envelope is the kit's standard JSON answer shape: `{ success, data, meta? }` or `{ success: false, error }`.

```ts
// src/api/index.ts: an Express router mounted at /api/{id}/
export const create = (ctx: PartContext): Router => {
  /* ctx.store.query(...) */
};
// src/mcp/index.ts: tools served as {id}__{name} on POST /mcp (SDK v2, stateless)
export function create(ctx: McpContext) {
  ctx.tool(
    'echo',
    { description, input: z.object({ msg: z.string() }), output: z.object({ msg: z.string() }) },
    async ({ msg }, caller) => ({ msg: `pong ${msg}` })
  );
  // Optional: title, annotations (hints) and output; instructions as a text or per caller.
  // The text is the JSON of the output; toolResult(markdown, { structured }) sends own text,
  // toolResult(text, { isError: true }) a tool error of that text only.
  ctx.instructions((caller) => `Notes of ${caller?.sub ?? 'nobody'}`);
  // The connector profile at /connector/{id}: tools listed by their own name (search, fetch).
  ctx.connector('search', { description, input, output }, async ({ query }, caller) => ({
    ids: [],
  }));
}
// The api part may also serve its files as git smart-HTTP at /files/{id}/* (raw body; Basic
// password = token). Only a clone or fetch reads ({id}:read); all else needs {id}:write. A dot
// segment is a 400. owner runs on every request (false = 403); a push over maxPushBytes is a 413.
// ctx.files((req, res) => { /* git http-backend */ }, { owner: (req: Request, caller) => true, maxPushBytes });
// src/api/index.ts with ctx.route: a non-JSON answer declares its media type and returns download()
ctx.route('get', '/export', { summary: 'Export', produces: 'application/zip' }, () =>
  download(zipStream, { filename: 'memories.zip' })
);
// /caller is the kit's route (the caller's sub and own scopes, docs/part-image.md): ctx.route refuses it
// bare: true answers the body with no envelope (errors keep it); with etag a GET answers 304
ctx.route('get', '/sync', { summary: 'Sync', bare: true, etag: true, output }, () =>
  reply(body, { etag: '"v1"' })
);
// src/worker/index.ts: five-field cron, never twice at once, every run saved with its log
export function create({ schedule, store, log }: WorkerContext) {
  schedule(
    'tick',
    '* * * * *',
    async () => {
      /* ... */
    },
    { timeout: '30s' }
  );
}
// src/cli/index.ts: one handler per command in agentage.commands
export function create({ out, args }: CliContext) {
  return { ping: async () => (out.log('pong'), 0) };
}
// src/pages/index.ts: path -> text or bytes, typed by the path's extension
export const create = (ctx: PagesContext): PagesSite => ({ '/': versionPage(ctx) });
```

The pages part maps each path to a page:

- A value is text or bytes. Its content type comes from the path's extension. A path with no
  extension is HTML. An unknown extension is served as `application/octet-stream`.
- `siteFromDir(dir, { origin: ctx.extension.origin })` serves a static export instead of a map.
- A `{ redirect: url }` value answers 308.
- A key that ends in `/*` covers every path under it. The rest of the path and the query are added
  to the target URL.
- A redirect target is an http(s) URL with a path and no query. Under a `/*` key it ends in `/`.

The ui part is a `widgets` map on [`@agentage/widget`](../packages/widget).

The app part is one root component in `src/app/index.tsx`, its default export. It imports
`react`, `react-dom` and `@agentage/extension/app`; the shell gives one copy of each. Turn it on with
`parts.app: true` and give its nav row:

```json
"agentage": { "id": "probe", "parts": { "api": true, "app": true },
  "app": { "title": "Probe", "icon": "radar", "order": 10 } }
```

- `title` is 1 to 40 characters. `icon` is a lucide icon name. `order` sorts the nav rows.
- The app is no image and no child process. The host serves `dist/app` as static files.
- The one container (the kit host on an app host) serves them too, anonymous, at `/app/{id}/*`, and its nav row (`title`, `icon`, `order`, `entry`, `css`) as JSON at `/app/{id}/`. An app host router reads that row into its host document and forwards `/app/{id}/*`.
- The tool's `app` command writes `dist/app`; `build` does it too. See [tool.md](tool.md).
- `check` warns on `fetch(` in `src/app`: an app calls its api through `useAppHost().api`.
- The app runs in the shell page, under its Content Security Policy (`default-src 'self'`, no `unsafe-inline`, no `unsafe-eval`; [shell-dashboard](../packages/shell-dashboard/README.md)):
  - Scripts, stylesheets and `fetch` calls: the page origin only. A script, a stylesheet or a call on another origin is refused.
  - Images and fonts: the page origin and `data:` URLs. A remote image or font does not load.
  - Styles: classes from the compiled `dist/app` stylesheet, or the React `style` prop. An injected `<style>` element, and a `style` attribute in an HTML string, are refused.
  - No `eval` and no `new Function`.
  - A refusal is a "Content Security Policy" error in the browser console and a `securitypolicyviolation` event on the page.
- `check` refuses an app part whose package.json does not declare `@agentage/components` `^0.21` (the kit app code imports it); `@agentage/extension` lists it as an optional peer. An app part that declares only `@agentage/design-system` is refused with the advice to switch. Both together give a warning: kit 0.22 and older still import the old library.

The manifest is the `agentage` block of the extension's `package.json`. See
[the probe extension](https://github.com/agentage/examples) for every part kind.

## Store

A postgres store adds two folders:

- `migrations/NNN-name.sql`: applied in order, each once, and recorded in `_migrations`. A failing
  file is named and rolled back.
- `seeds/`: runs once, on an empty store. An empty store has no `_migrations` row and no table
  except the kit's own. If the first run fails, the next run tries the seeds again.

`ctx.store` is a ready connection pool. A query gets 10 s. A connection gets 5 s. A store that
cannot answer gives `UNAVAILABLE` (503, with `Retry-After`), never a 500.

A clickhouse store has no migrations. In the host, with `AGENTAGE_STORE_URL_FILE` set,
`clickhouseOf(ctx)` gives `query` (named `{name:Type}` parameters), `command`, `insert` and `ping`;
elsewhere its calls say the store is missing. See
[Estate stores in the host](part-image.md#estate-stores-in-the-host).

A git store is a folder. `ctx.store.gitRoot` is `data/{id}` (a temp folder when the host has no
data folder); the part lays out its repos there and runs `git` itself. The host holds the data lock,
so one process writes the folder. Run each `git` with `{ cwd: ctx.store.git.cwd, env:
ctx.store.git.env }`: the env has only `PATH` from the parent, `HOME` = the root, no system or global
config, hooks off (`core.hooksPath=/dev/null`), no prompt, and the protocols `file:http:https`
only. In the cloud, `ctx.store.git.remote` is the store-git URL to push to, with no credential in
it; the credential is an `http.<remote>.extraHeader` in the env, so it never shows in argv, a URL
or git error text. Never log the env. `ctx.store.query` refuses. `/health` checks that the root is
writable (`checks.store`, `checks["store:git"]`).

## Workers and commands

- Each worker run is saved in the table `agentage_job_runs`. A row holds the job, start, end,
  status and log. The log is cut at 64 KB. The table keeps the last 50 runs per job.
- Without a store, the runs stay in memory. `/health` reports each job as `job:{name}`.
- Commands answer with `out.log/warn/error/table/json/fail`.
- Exit codes: 0 ok, 2 usage, 1 failure. `--json` sends only `out.json` to stdout.

## Logs and spans

- `ctx.span(name, fn)` runs `fn` and writes one `span` row on the current agcid. The value and
  any throw pass through. It is on server parts and the cli.
- Every request is one `http` row, every `tools/call` one `mcp` row, every job run one `job` row.
- The agcid (the request id) comes from the `agcid` header or `traceparent`. Without either, the
  kit mints one.
- `ctx.exit()` runs the normal SIGTERM shutdown once the current answer is sent. Part code never
  touches `process`.
- `ctx.health(name, check)` adds a check to `/health`.

## Tests

- `createTestContext()`: a recording log, `ctx.spans`, jobs you run with `runJob`, tools.
  `{ store: true }` gives a throwaway in-process postgres with the package's migrations and seeds.
  `{ args }` gives a command context that records its output.
- `startTestServer({ create })` tests an api part. `startTestMcp({ create })` tests an mcp part.
- `mcpSnapshot(url, '2025-11-25' | '2026-07-28')` from `@agentage/extension/tool` writes the
  committed `{id}.mcpc.json`.
- The wire schemas a client reads are in `@agentage/extension/contracts`.
