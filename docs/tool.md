# The tool: build, up, token

Words used here:

- **Record**: the build file that lists a release's images by digest (`.agentage/record.json`).
- **Sealing**: the check rule that part code may not read `process.env`, call `listen()` or name an absolute agentage URL.

The paths below are relative to the root of this repo. `--dir <ext>` names the extension folder.
The default is the current folder. Inside an extension, `npx agentage extension <command>` runs the
same tool. `build` and `up` need Docker. The extension must be a git checkout with a commit.

```bash
node packages/extension/dist/tool/cli.js build [--push] [--dir <ext>] [--registry <host/owner>]
node packages/extension/dist/tool/cli.js build --container [--push]  # one image, the api part
node packages/extension/dist/tool/cli.js up [--dir <ext>]       # agentage extension up
node packages/extension/dist/tool/cli.js app [--dir <ext>]      # dist/app only, no Docker
node packages/extension/dist/tool/cli.js down [--keep-data]
node packages/extension/dist/tool/cli.js token --scope probe:read
```

`build` runs these steps in order:

1. Validate the manifest and run the package's `npm run build`. With the app part, write
   `dist/app` (below).
2. Run the six check rules (`tool/check.ts`, `tool/rules/`). Any problem stops the build before an
   image. A manifest problem stops the later rules.
3. Build one image per part (pages, ui, api, mcp, worker), tagged
   `ghcr.io/agentage/{id}-{part}:{version}`.
4. With `--push`, push the images and write `dist/agentage-extension.json` (images by digest,
   tools, commands, widgets, the store and its migration count, the OpenAPI path).

The six rules:

| Rule       | Checks                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest` | the `agentage` block is valid; a problem here stops the later rules                                                                                              |
| `entries`  | `npm run build` ran (`dist/` exists); each part is built and exports only `create`; no export holds part code                                                    |
| `surface`  | the committed `openapi.json` and `{id}.mcpc.json` equal what the code serves                                                                                     |
| `stack`    | dependency ranges fit express 5, zod 4, `@modelcontextprotocol/server` 2 and the kit range in `engines.agentage`; an older kit minor from `0.12` up is a warning |
| `store`    | migrations apply on a real postgres; `check` skips it without Docker                                                                                             |
| `sealing`  | no `process`, no `listen()`, no absolute agentage URL; a part imports only its own folder and `src/lib` (type-only imports are exempt)                           |

`npm run check:fixtures` shows one fixture refused per rule. Under `build` the `store` rule needs
Docker and fails without it (`tool/rules/store.ts`).

Each image is multi-stage `node:26-alpine` with `npm ci --omit=dev`, `USER node` and a
`HEALTHCHECK` on `127.0.0.1`. It carries only `dist/{part}` and `dist/lib`. The api image also
carries `openapi.json`, `migrations/` and the migrate entry `node dist/store/migrate.js`. Seeds
never ship in an image.

`build --container` runs the same first two steps, then builds one image, tagged
`ghcr.io/agentage/{id}:{version}`. Its entry is the kit host `dist/host/main.js` on port `8080`
(see [Host one extension](part-image.md#host-one-extension)). The host runs the api, mcp and
worker parts in one process. A package with none of them is refused. The build prints one line,
`runs: api, mcp, worker; skipped: pages, ui`, and the result has `container.runs` and
`container.skipped`. The `cli` part is not an image part, so it is not listed.

The image carries `dist/`, `openapi.json` and `migrations/`. Compiled tests, source maps and
`dist/agentage-*.json` stay out. A postgres store adds PGlite and a `/data` volume. The PGlite
version is the exact one in the package lock, else the copy the kit resolves; a range is refused.

With `--push` it writes `dist/agentage-container.json`: the record with `image` (`{id}@sha256:...`)
in place of part images. The labels name no part. The release record and the part images do not
change.

`up` runs these steps:

1. Build the same images and write `.agentage/record.json` from the local digests.
2. Render one compose file. It holds postgres 18 (migrate job first, `seeds/` mounted) and a dev
   token issuer on `localhost:4281`. It also holds a Traefik gateway on `localhost:4280` and one
   container per part.
3. Print one line per step, ending `ready N parts healthy`.

Each working copy is its own compose project (`agentage-{id}-{8 hex of the folder}`). `up`
refuses while another copy holds 4280 or 4281, and names that copy. `down` removes this copy's
project only; `--keep-data` keeps the store volume.

`token` mints a dev token: `aga_` plus an EdDSA JWT, `{id}:{verb}` scopes, valid 1 hour. `--scope`
is required. The parts of `up` check it like a deployment's. The issuer also takes `ttlSeconds`,
`aud` and `POST /revoke { jti }`.

Every docker, git and npm call has a timeout (`tool/timeouts.ts`). No call retries, so a re-run
is safe. The cli runs the same code as `agentage extension check|build|up|down|token` through
`@agentage/extension/tool`.

## The app bundle

`app` (and `build` for a package with the app part) bundles `src/app/index.tsx` with esbuild and
compiles its Tailwind classes. It writes four kinds of file to `dist/app`:

| File             | What                                                                                                                      | Cache     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | --------- |
| `app-<hash>.js`  | the bundle; `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` and `@agentage/extension/app` stay bare imports | immutable |
| `app-<hash>.css` | the Tailwind utilities that `src/app` uses; no preflight, no theme variables                                              | immutable |
| `index.js`       | `export { default } from './app-<hash>.js'`                                                                               | no-cache  |
| `app.json`       | `{ "entry": "app-<hash>.js", "css": "app-<hash>.css" }`, read by the host                                                 | no-cache  |

- The build keeps the files of the previous build: an open page can still import them.
- `esbuild`, `postcss`, `@tailwindcss/postcss` and `tailwindcss` are required for an app part (the
  extension template adds them as dev dependencies). The tool takes the extension's own copy first,
  then the copy beside the kit. If one is missing, the build stops at once and names it.
- When `@agentage/extension/app/theme.css` resolves, its `@theme` names (the shell's tokens) give utilities
  such as `bg-primary`. They read the shell's variables.
- `appBuilder(dir)` from `@agentage/extension/tool` keeps esbuild warm: `rebuild()` on each save,
  `dispose()` at the end.
