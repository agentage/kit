# extension-template

An agentage extension: one npm package that adds pages, a widget, an API, MCP tools, a job,
terminal commands and an app to agentage. `agentage extension create` made this repo. Each part is
one folder in `src/`; the `store` part is `migrations/` and `seeds/`. Delete the lines of this
README about the parts you did not keep.

You need Node 22 or newer, npm 10 or newer and git. `up --docker` also needs Docker.

## Quick start

```bash
npm ci
npm run verify                  # type-check, lint, format, test, build
npx agentage extension check    # PASS template <version> conforms (6 rules)
git init -b master && git add -A && git commit -m "feat: template extension"
```

Use `npx agentage` in this folder: it runs the cli version that `package.json` pins. A global
`agentage` can be older. `up` needs one git commit; `build` needs a clean tree. More:
[when up or build stops](docs/run-locally.md#when-up-or-build-stops).

### Run it on your machine

```bash
npx agentage extension up       # runs this folder on the local daemon, reloads each change
npx agentage extension down     # removes it from the daemon again
```

`up` runs the api, the mcp tools (`/mcp/template`) and the worker on the daemon at
`127.0.0.1:4243`, with no token. Each saved change in `src/` reloads it.

`up --docker` runs the release images instead, as a deployment does. It needs the ports 4280 and
4281 free and prints `ready N parts healthy` when it is done:

```bash
npx agentage extension up --docker
T=$(npx agentage extension token --scope template:read)
curl -s -H "Authorization: Bearer $T" "localhost:4280/api/template/echo?msg=hi"
npx agentage extension down     # removes the containers, the network and the volume
```

### Call it

- `GET /api/template/echo?msg=hi` with a token answers 200; without `msg`, 400.
- `GET /api/template/ping` is public and answers 200 with `pong`.
- A protected route without a token answers 401.
- The MCP tool `template__echo` is at `POST /mcp`, with the same token.

`openapi.json` lists the routes and `template.mcpc.json` lists the tools. More:
[answers](docs/run-locally.md#answers) and [health and logs](docs/run-locally.md#health-and-logs).

## What it serves

- pages, `src/pages`: `/` shows the id, the version and the commit.
- ui, `src/ui`: the widget `<template-echo>`.
- api, `src/api`: `GET /api/template/echo` (scope `template:read`) and `GET /api/template/ping` (public).
- mcp, `src/mcp`: the tool `template__echo` (scope `template:read`).
- worker, `src/worker`: the job `tick`, every minute.
- store, `migrations/` and `seeds/`: postgres. A seed runs once, on an empty store.
- cli, `src/cli`: `agentage ping [msg]` prints `pong`.
- app, `src/app`: the shell page `/template`, an Echo button that calls the api.

After you change a route or a tool, write the contracts again:

```bash
npm run build && npx agentage extension check --write && npm run format
```

## Release

A merge to master is the release. `.github/workflows/release.yml` runs
`agentage extension release --changed`. When the extension changed since its last tag, it gets a
date version such as `2026.1122.1` and the tag `template@<version>`. The run pushes the images and
attaches the records `agentage-container.json` and `agentage-extension.json` to the GitHub release.
A change only in a root `*.md` file, `docs/` or `.github/` releases nothing; `.release-ignore`
adds more patterns.

Do not raise the version in `package.json` by hand. A fix is a new merge: never move a tag.

The package is private (`"private": true`), so a release never publishes it to npm. To publish on
purpose: add `release.yml` of this repo as the trusted publisher of the name on npmjs.com, remove
`"private": true` from `package.json`, and merge. The next release publishes the package.

## Deploy

A release deploys nothing. An operator adds the id and the version to an app host. The app host
then serves `/api/template/...` and `/mcp/template` at its own address. More:
[CLAUDE.md](CLAUDE.md#6-the-deployment-row).

## For agents

Read [CLAUDE.md](CLAUDE.md) first: the rules for a change, where each fact lives, and what CI
checks. Run `npm run verify` and `npx agentage extension check` before each push.

## License

[MIT](LICENSE).
