# platform

agentage is a small platform that runs extensions. An extension is one npm package that adds pages,
an app, widgets, an API, MCP tools, jobs or CLI commands. This repo holds the kit, the library every
extension is built on. Extension authors, the agentage cli and the web pages that show widgets use
it, and it holds no product code.

## Start

To write an extension, make one from the template. You need Node 22+, npm 10+ and git. `build` and
`up --docker` also need Docker.

```bash
npx @agentage/cli@latest extension create <id> [part...]   # makes ./extension-<id>
cd extension-<id> && npm ci                                # installs the cli the project pins
git init -q && git add -A && git commit -qm init           # up needs one commit
npx agentage extension up                                  # runs it on the local daemon
```

No part named means all parts. `up` runs the package's `build` script itself, adds the folder to
the daemon on `127.0.0.1:4243` and reloads the extension at each change. `up --docker` runs the
part images on Docker instead; it needs the ports 4280 and 4281 free. The template and its guide are in
[extension-template](https://github.com/agentage/extension-template).

To work on this repo, you need Node 22+ and npm 10+:

```bash
npm ci
npm run build
npm run verify
```

## Words used here

- **Extension**: one npm package whose `package.json` has an `agentage` block (the manifest).
- **Part**: one folder of an extension: `pages`, `app`, `ui`, `api`, `mcp`, `worker` or `cli`. A
  `store` (postgres, git, clickhouse or signoz) is a part with no code folder.
- **Kit**: the library that runs a part. It owns servers, ports, `/health` and the store.
- **Tool**: the build and local-run program in the kit. The cli runs it as `agentage extension`.
- **agcid**: the request id. It is 32 hex characters.

## Packages

- [`@agentage/extension`](packages/extension): the extension kit and its tool (one image per part).
- [`@agentage/logs`](packages/logs): the event line: one JSON row per unit of work on stderr.
  It is private: the kit ships it inside its own tarball. Import it from `@agentage/extension/logs`.
- [`@agentage/widget`](packages/widget): the `ui` part. React widgets as custom elements, the host
  bridge (`useHost`), `Button` and `Card`, and the bundler with its harness page.
- [`@agentage/shell`](packages/shell): the shell kit. `readInstallation` reads what a target runs.
  `mountWidgets` places each extension's widgets by the layout of a route.
- [`@agentage/identity`](packages/identity): the identity client for browser pages. Sign in at
  auth, get a one-hour token for the parts, `mintToken`, `revokeToken`, sign out.
- [`packages/app`](packages/app): the app kit, `useAppShell`, `useAppHost`, `Region`, `Split`.
  It is private: import it from `@agentage/extension/app`.
- [`packages/shell-dashboard`](packages/shell-dashboard): the dashboard shell. It is private: the
  kit ships it at `dist/shell`, and the daemon serves it at `/`.

## Write the parts

Each part exports only `create(ctx)`. Part code never reads `process.env` or starts a server.

```ts
// src/mcp/index.ts: tools served as {id}__{name} on POST /mcp
export function create(ctx: McpContext) {
  ctx.tool('echo', { description, input, output }, async ({ msg }) => ({ msg: `pong ${msg}` }));
}
```

- `pages`: a map of paths to pages, files or redirects.
- `ui`: a `widgets` map of React components.
- `app`: one React root component in `src/app/index.tsx`, shown in the dashboard shell.
- `api`: an Express router mounted at `/api/{id}/`. A part image also serves it at `/api/v1/`
  during the move.
- `mcp`: MCP tools, as above.
- `worker`: jobs on a five-field cron. A job never runs twice at once.
- `cli`: one handler per command in `agentage.commands`.

[extension-probe](https://github.com/agentage/extension-probe) has every part kind.

More: [docs/parts.md](docs/parts.md).

## The tool: build, up, token

Run each command as `npx agentage extension <command>` inside the extension folder.

- `check`: runs the six check rules. `--write` first rewrites the committed contracts.
- `build`: checks, then builds one image per server part. `--push` pushes the images. Needs Docker
  and a committed, clean git tree (the cli checks this).
- `up`: runs the working copy on the local daemon and reloads it at each change. `up --docker`
  runs it on Docker, with a store, a gateway on `localhost:4280` and a dev token issuer on
  `localhost:4281`.
- `down`: removes what `up` started. `--keep-data` keeps the store volume.
- `token --scope <id>:<verb>`: prints a dev token for the parts that `up --docker` started.

More: [docs/tool.md](docs/tool.md).

## Run a part image

An image starts with `node node_modules/@agentage/extension/dist/runtime/main.js <part>`. It
listens on port 3000. `PORT` changes the port. `AGENTAGE_*` variables set the origin, store,
settings and tokens.

More: [docs/part-image.md](docs/part-image.md).

## Host extensions on a machine

`@agentage/extension/host` runs the api, mcp and worker parts of one package in one process
(`hostExtension`). `createDaemon` is the local app host: one child per extension, `/api/{id}/*`,
`/mcp/{id}`, `/app/{id}/*` and the dashboard shell at `/`. The cli starts it as `agentage daemon`.
The contract is in [docs/part-image.md](docs/part-image.md#host-one-extension) and [docs/daemon.md](docs/daemon.md).

## Write a widget

`src/ui/index.ts` exports `widgets = { echo: Echo }`, each a React component. The full API, the
import table and the harness page are in [`packages/widget`](packages/widget/README.md).

## Verify

```bash
npm run verify
npm run test:e2e
npm run test:e2e -w @agentage/shell-dashboard
```

`test:e2e` runs the widget harness in Chromium with an axe WCAG A/AA sweep and screenshots in both
themes. The second e2e command checks the dashboard shell against its prototype at 1280 and
400 px. The widget screenshot baselines come from the CI container image.

## Release

A `v<version>` tag on master, or a manual dispatch, runs `.github/workflows/release.yml`. The tag
must be the version of one package. The workflow runs `verify`, then publishes every package
version not yet on npm, using OIDC trusted publishing with provenance. It skips private packages.

Before that, CI builds [extension-probe](https://github.com/agentage/extension-probe) on the
packed packages, runs `up`, and checks every part image and the served discovery document. A kit
change is proven in containers before it ships.

## License

MIT. See [LICENSE](LICENSE).

## Documentation

- [docs/parts.md](docs/parts.md): write each part, the store, workers, logs and spans, tests.
- [docs/tool.md](docs/tool.md): build, check, up, down and token in detail.
- [docs/part-image.md](docs/part-image.md): run a part image in a deployment, every setting and the
  host.
- [docs/daemon.md](docs/daemon.md): the local daemon, its routes, limits and seal.
