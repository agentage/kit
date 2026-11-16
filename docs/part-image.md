# Run a part image

A part image is the container image `build` makes for one part. A deployment sets these values
when it runs the image. The audience (`AGENTAGE_AUDIENCE`) is the host a token is valid for: one host, or `*.{domain}`.

| Setting                                                   | Meaning                                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Entry                                                     | `node node_modules/@agentage/extension/dist/runtime/main.js <part>`; port `3000` (`PORT` overrides)                          |
| `/health`                                                 | loopback only (the container `HEALTHCHECK`, an operator on the node); `404` from any other address                           |
| `/.well-known/agentage-extension.json`                    | the record at `/run/agentage/agentage-extension.json` (`AGENTAGE_RECORD_FILE`) plus the host                                 |
| `AGENTAGE_ORIGIN`                                         | the deployment's origin; pages and ui take it from the request without it                                                    |
| `AGENTAGE_SETTINGS`                                       | JSON of setting values over the manifest defaults                                                                            |
| `AGENTAGE_STORE_URL` / `_FILE`                            | the postgres connection (or a file holding it); else libpq `PG*` variables                                                   |
| `AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_ORIGIN` | required for api and mcp. Without them the part does not start. It also does not start when its host is not in the audience. |
| `AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE` on pages           | CSP script-src, connect-src add these hosts; helmet's style-src keeps 'unsafe-inline'                                        |
| `AGENTAGE_TELEMETRY_URL`                                  | `ctx.platform.telemetry` (with `issuer`, `audience`; a value a part lacks is `''`)                                           |
| `AGENTAGE_DEV_ISSUER`                                     | set by `up` for the ui part only: its CSP then lets the harness reach the dev issuer                                         |
| `Cookie` request header                                   | dropped before any handler; a part sets no cookie and its CORS carries no credentials                                        |

JSON Schemas for the manifest, the build record, the discovery document, `/health` and the
envelope are in [`packages/extension/schemas`](../packages/extension/schemas). Regenerate them with
`npm run build && npm run schemas`.

## Host one extension

`@agentage/extension/host` exports `hostExtension(dir, opts)`. It runs every server part of the
package in `dir` on one app and one port: the api at `/api/{id}/*`, the mcp at `/mcp/{id}` and
the worker jobs. The parts share one store and one `/health`, which lists them in `parts`. The
jobs start after every `create` and stop before the store closes. With no token check,
`tools/list` is open. On `127.0.0.1` the host accepts only a local Host and Origin, at its own
port or at the port of `AGENTAGE_ORIGIN`. The daemon child and the one container run the entry
`node node_modules/@agentage/extension/dist/host/main.js`.

| Env                      | Meaning                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | the port, `8080` by default; `0` lets the OS pick, and the port goes to the parent over IPC                                                                                                                                                                                     |
| `AGENTAGE_EXTENSION_DIR` | the package folder, the current folder by default                                                                                                                                                                                                                               |
| `AGENTAGE_DATA_DIR`      | the PGlite folder of a postgres store; `<dir>.lock` holds the pid. Unset: in memory, a warn line                                                                                                                                                                                |
| `AGENTAGE_SETTINGS`      | JSON of setting values over the manifest defaults                                                                                                                                                                                                                               |
| `AGENTAGE_SECRETS_DIR`   | one file per declared secret, `/run/secrets` by default                                                                                                                                                                                                                         |
| `AGENTAGE_ORIGIN`        | `ctx.extension.origin`, `http://127.0.0.1:<PORT>` by default                                                                                                                                                                                                                    |
| `AGENTAGE_DRAIN_MS`      | how long SIGTERM may drain before exit 1, `10000` by default                                                                                                                                                                                                                    |
| `AGENTAGE_STORE_OPEN_MS` | how long the store may take to open (and to close), `120000` by default; then the api starts and `/health` says the store is `unavailable` until it opens. Under the daemon it is the daemon's `healthMs` (raise both with `createDaemon({ healthMs })`, and `startMs` with it) |
| `AGENTAGE_HOST_BIND=all` | listen on every address. It needs a token check (`AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_ORIGIN`) or `AGENTAGE_HOST_AUTH=off`                                                                                                                                         |

The one container (`build --container`) sets `AGENTAGE_HOST_BIND=all`, `PORT=8080` and
`AGENTAGE_DRAIN_MS=8000`. With a postgres store it also sets `AGENTAGE_DATA_DIR=/data/store` on the
volume `/data`. So it needs the token values, or `-e AGENTAGE_HOST_AUTH=off` for a local run.
`/health` answers on loopback only: use `docker exec` or the `HEALTHCHECK` state.

```bash
docker run -p 8080:8080 -e AGENTAGE_HOST_AUTH=off -v probe-data:/data ghcr.io/agentage/probe:0.7.0
```

- Any `AGENTAGE_HOST_BIND` other than `all` binds loopback with no token check. With
  `--network host` that is the loopback of the machine.
- The drain ends within 8 s, under the 10 s of `docker stop`. A longer drain needs both a higher
  `AGENTAGE_DRAIN_MS` and `docker run --stop-timeout <s>`.
- `--read-only` works: only `/data` is written, and `/tmp` needs no tmpfs.

`localOnly(port)` from `@agentage/extension/host` is the guard of the daemon, as Express middleware.
A request needs the Host `127.0.0.1` or `localhost` at that port (`[::1]` is refused: nothing
listens there), no other Origin, and no cross-site `Sec-Fetch-Site`, or it throws a 403
`FORBIDDEN` for the error handler. With no port given, it compares against the port of the socket
the request came in on. `hostExtension(dir, { localOnly: true })` mounts it before every route, at
the port of the socket. A client checks support with `capabilities` from `/tool` or `/host`:
`container` (`build --container`), `localOnly`, `installDisabled` (`POST /host/extensions` takes
`enabled: false`), `updateInstallation` and `withFileLock` (the exports below).

On loopback there is no token check. SIGTERM drains the open requests, closes the store and
exits 0. `ctx.exit()` does the same. The host brings `@electric-sql/pglite`; the package does not
need it.

The daemon (`createDaemon`) answers `/api/{id}/*` from the child of that extension. It answers 404
`NOT_FOUND` for an id that is not installed or is disabled; a client does not retry it. It answers
503 `UNAVAILABLE` with `Retry-After` while the extension is starting or failed, or when a request
waited past `gateMs` for a change to end. A child that sends no answer headers in `answerMs` gets
504 `TIMEOUT` ("The extension did not answer in <ms> ms"). A 504, and a 503 "The extension did
not answer", can come after the extension applied the call: retry only an idempotent call. A
request counted on the old child before a swap is answered there while it drains (`drainMs`).

While a change is taken and not yet answered (queued too), `/health` lists it in `pending`:
`[{ op: "install" | "update" | "remove" | "reload", id?, source?, since, timedOut? }]`; the field is left
out when nothing is pending. An installer call past `installMs` stays listed with `timedOut: true`
until it ends, and a second installer call for that id meanwhile is 409 `CONFLICT` with that row
in `error.details`. So an installer that never ends keeps its id at 409 until the daemon restarts.
A `POST` for an id that is installed is 409 `CONFLICT` with `error.details`
`{ id, version?, source? }` of the entry that is there. A change that waits `installMs` for the
changes before it (the boot too) is 503 `UNAVAILABLE` and never runs. Once `stop()` begins, a
queued change is 503 `UNAVAILABLE` ("the daemon stops"), no child starts, and a child still
starting is stopped before `stop()` resolves.

`POST /host/extensions` with `enabled: false` records the extension (the installer runs for an
`{ id }`) and never starts it. At each boot the installer runs for a disabled `{ id }` entry too:
its folder is found and nothing starts, so `PATCH { settings }` and `PATCH { enabled: true }`
work after a restart. A failed installer keeps the entry disabled, with the reason in `error`.

A change writes `installation.json`, `settings.json`, then `secrets.json` (a remove writes them in
the other order, so a crash half way leaves no secret for a later install of that id). The daemon
changes its state and children only after all three are written. A failed write puts back the
files written before it, so the files, the list and the running child stay as they were. When that
put-back fails too, the daemon writes one warn line and `/health` lists the id in `unsynced`
(status `degraded`) until a later write of that id passes. Only a remove of an id deletes its
`settings.json` and `secrets.json` rows; a boot never does, whatever `installation.json` holds.

When `installation.json` cannot be read (`EACCES`, `EISDIR`), the daemon never writes it:
`/health` says `installation: "unreadable"` and `installationError`, and each change is 409
`INSTALLATION_UNREADABLE` until the file is fixed (unreadable at boot: also a restart). A file at
boot that is not JSON, has rows C3 refuses or an id twice, is kept as `installation.json.bad` and
replaced by the valid rows (the first of each id) the daemon runs; `/health` says
`installation: "invalid"`. A file that turns not JSON after boot is never written: each change is
409 `INSTALLATION_UNREADABLE` ("not JSON") until it is fixed. A write that finds a daemon file
locked by another live process waits `lockMs`, then is 503 `UNAVAILABLE` naming the pid
("installation.json is locked by process <pid>: waited <ms> ms"). The data lock falls back to an
exclusive create on a volume with no hard links; an empty lock file is taken as being written for
1 s, then as stale. One starter at a time removes a stale lock (it holds `<dataDir>.lock.break`),
so of many starters at once only one takes it.

Refuse and restart (C6). A new id whose first start fails is 400 `VALIDATION_ERROR` with
`details: { code: "START_FAILED", reason }`: its `installation.json` row goes, and its `data/{id}/`
only when this start made it (the data of an id that had a folder, and its settings and secrets
rows, stay). A `PATCH` that fails to start answers the same envelope and the old child runs again.
A declared secret of a server part with no value is checked before the fork: the install is kept,
state `failed`, error `needs secret <name>`; `PATCH { secrets }` starts it. A running child that
exits restarts after `backoffMs` (1, 2, 4, 8, 16 s, by the restarts since the last reset; the last
value repeats); a restart that does not start counts as an exit. `crashLimit` (5) exits in
`crashWindowMs` (10 min) is `failed`, error `exited 5 times in 10 min: <last words>` (the child's
last stderr line above info), and no more restarts. While it waits the state is `starting`, the
error `<last words>: restart in <ms> ms`. A `PATCH` that starts it (enable, configure, update) or a
reload resets the count. A restart runs in the change queue; a change, remove or stop cancels it.

Reload (D14). `POST /host/extensions/{id}/reload`, body `{}`, for a folder row only (a market row
is 400 `VALIDATION_ERROR`, a disabled one 409 `CONFLICT`). In the change queue (a second reload
waits): requests wait at the gate (`gateMs`), the child stops and its exit is awaited, `dist` is
renamed to `dist.prev` and `dist.next` to `dist` (with no `dist.next` it restarts on `dist`), the
new child starts and must be healthy. Then 200 `{ id, version, state, pid, reloaded: true }`.
Not healthy: `dist` goes back to `dist.next`, `dist.prev` to `dist`, the last good build starts, 200
`{ ..., reloaded: false, refused: "<why>" }`; the store rows stay. `run/{id}/reload.json` is written
before the swap and removed after; at boot a marker means a cut reload, and the last good build
goes back to `dist`. A reload exit is not a crash exit.

Two exports from `/host` write the daemon files under the kit's lock, for a client that moves
older files before the daemon starts:

- `updateInstallation(configDir, change, waitMs?)`: read, change and write `installation.json`,
  the path the daemon uses. It refuses a row C3 refuses or an id twice, and keeps a file that is
  not C3 as `installation.json.bad` first. Call it only while no daemon runs on `configDir`: the
  daemon reads the file at its start and owns it after. When `daemon.json` names a live process
  that answers `/health` as that daemon, it is 409 `DAEMON_RUNNING`, unless the caller is that
  process.
- `withFileLock(file, fn, waitMs?)`: `fn` runs while `<file>.lock` is held, as for each daemon
  file; a live holder past `waitMs` (5 s) is 503 naming its pid.

Each wait of the daemon has a bound, a `createDaemon` option:

| Option                        | Default                           | Bounds                                                                                  |
| ----------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `startMs`                     | `60000`                           | a forked child's port report; then `SIGKILL`, "reported no port in <ms> ms: killed"     |
| `healthMs`                    | `60000`                           | a new child's own `/health`                                                             |
| `drainMs`                     | `10000`                           | the open requests of an old child before it stops (then `SIGTERM`, `SIGKILL` after 5 s) |
| `gateMs`                      | `30000`                           | a request held while its extension swaps children; then 503                             |
| `answerMs`                    | `60000`                           | a child's answer headers, from the start of the request; then 504                       |
| `lockMs`                      | `5000`                            | a write waiting for another process's lock of a daemon file; then 503                   |
| `installMs`                   | `660000`                          | one `Installer` call, then 504 (at boot the entry fails); a queued change, then 503     |
| `backoffMs`                   | `[1000, 2000, 4000, 8000, 16000]` | the wait before each restart of a child that exited                                     |
| `crashLimit`, `crashWindowMs` | `5`, `600000`                     | this many exits in the window is `failed`                                               |

The 11 min of `installMs` is above the cli's npm bound (10 min) and below its client wait (12 min).

The daemon (`createDaemon`) answers `/health` with `service: "agentage-daemon"`, `pid`, `version`
and `protocol`, the values of `daemon.json`, so a client can prove which process it talks to. A
`PATCH {settings}` string becomes the type the manifest declares (`"5"` to `5`, `"true"`); any
other value, or an undeclared key, is `400 INVALID_SETTING`. A `PATCH` that changes nothing (the
same values and version, the entry already running or disabled as asked) is 200 and starts no
child; a `PATCH` of a failed entry starts it again. An `Installer` error with a string `code` (and
`status` 400, 404 or 502) is the client's error; any other error is a logged `500`. The daemon
calls the `Installer` again on every boot, once for each entry with a version, one at a time:
first the enabled ones (after the folder entries), then the disabled ones. So it must be idempotent
and fast for a version that is already installed. Its spec carries a `signal`, aborted only when
the daemon stops waiting (`installMs`); an installer that ignores it keeps running (`pending`
shows it).
Statuses, not codes, tell a retry: 503 `UNAVAILABLE` is worth a retry after `Retry-After`; 504
`TIMEOUT` means the call may still be applied.
