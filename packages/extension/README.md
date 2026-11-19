# @agentage/extension

The agentage extension kit. Each server and cli part (pages, api, mcp, worker, cli) exports only
`create(ctx)` (the ui part is a `widgets` map, the app part one React root component); the kit owns the server, port, `/health`, the discovery document, the `agcid`
correlation id, the response envelope, the store pool, the scheduler and argument parsing.
`@agentage/extension/tool` is the tool behind `agentage extension check | build | up --docker | down | token`.
`@agentage/extension/host` is the host and the daemon, `@agentage/extension/contracts` the wire
schemas.
`@agentage/extension/logs` is the event line (`EventSchema`, `parseLine`, `createLogger`,
`createEventsClient`, `KINDS`, `LEVELS`, `USER_TYPES`), built into the kit's own tarball.
`@agentage/extension/core` is the one client of the core's services (see "The core client").
`@agentage/extension/app` is the app part: `useAppShell()` (route, regions, notices, state) and
`useAppHost()` (`user`, `scopes`, `api`, and since 0.18.2 `extension { id, version }` and
`host { kind, url }`, kind `local`, `desktop` or `cloud`).

```bash
npm install @agentage/extension express zod
```

## The core client

`createCoreClient({ url, timeoutMs, token })` calls the core: `market.latest(id)`, `market.list()`,
`logs.send(rows)` and `down()`. It never throws. Each method call ends before `timeoutMs` (default
2000 ms), all its requests together.

- Each call answers `{ data, down }`. When the core is silent, `data` is the empty answer: `null`
  or an empty listing. `down` then has a `code` and the message `market not reachable` or `logs not reachable`.
- `data: null, down: null` from `market.latest` means the market has no such id (its 404).
  A caller that must not read silence as "no release" checks `down`.
- `down()` keeps the first reason of any call of the client.
- The address: `url` (an origin, or a function that resolves one), else `AGENTAGE_CORE_URL` of
  `env`. A missing or empty address is no error: each call answers `down.code` `no_core`.
- `logs.send` drops a failed send with one warning, until a send goes through again. It needs
  `token`, sent over https or to a loopback host only.
- `./core` is for Node: `logs.send` uses the Node events client. The market reads import nothing, so a
  browser entry for them is a small split later.

| `down.code`   | When                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `no_core`     | no address, not a URL, or the `url` function threw (`cause`)             |
| `unreachable` | no connection                                                            |
| `timeout`     | no answer before `timeoutMs`                                             |
| `failed`      | a status that is not 2xx or 404, a redirect, too large                   |
| `not_json`    | a market body that is not JSON                                           |
| `refused`     | a market 2xx with no release or rows, or not an exact version of that id |
| `no_token`    | `logs.send` with no token                                                |

`agentage extension check [dir] --json` prints the conformance report (exit 1 when `conforms` is
false); `file` and `line` are there only when a problem has them. `warnings` is there only when a
rule warned: an `engines.agentage` of an older kit minor from the floor `0.12` up conforms with a
warning; below the floor or above the running kit it is a problem:

```json
{
  "id": "probe",
  "version": "0.4.0",
  "conforms": false,
  "rules": ["manifest", "entries", "surface", "stack", "store", "sealing"],
  "problems": [
    { "rule": "sealing", "file": "src/api/index.ts", "line": 7, "problem": "reads process.env" }
  ],
  "skipped": {}
}
```

Secrets: `agentage.secrets` lists names, never values. A plain name is mounted in every part
but ui; `{ "name": "github-app-key", "parts": ["worker"] }` only in the parts it names. Any
other part starts without it, and a read of `ctx.secrets.githubAppKey` there throws. A test
takes a part's view with `createTestContext({ extension: { part: 'worker' } })`.

See the [platform README](https://github.com/agentage/platform#readme) for every part kind, the
manifest, the tool and how a part image runs.
