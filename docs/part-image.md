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

| Env                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | the port, `8080` by default; `0` lets the OS pick, and the port goes to the parent over IPC                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `AGENTAGE_EXTENSION_DIR`  | the package folder, the current folder by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AGENTAGE_DATA_DIR`       | the PGlite folder of a postgres store; `<dir>.lock` holds the pid. Unset: in memory, a warn line                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `AGENTAGE_RUN_DIR`        | the daemon's `run/{id}`: the store lock is `run/{id}/store.lock` there in place of `<dir>.lock`. Unset (the one container): `<dir>.lock`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `AGENTAGE_SETTINGS`       | JSON of setting values over the manifest defaults                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AGENTAGE_SECRETS_DIR`    | one file per declared secret, `/run/secrets` by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `AGENTAGE_ORIGIN`         | `ctx.extension.origin`, `http://127.0.0.1:<PORT>` by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `AGENTAGE_DRAIN_MS`       | how long SIGTERM may drain before exit 1, `10000` by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `AGENTAGE_STORE_OPEN_MS`  | how long the store may take to open (and to close), `120000` by default; then the api starts and `/health` says the store is `unavailable` until it opens. Under the daemon it is the daemon's `healthMs` (raise both with `createDaemon({ healthMs })`, and `startMs` with it)                                                                                                                                                                                                                                                          |
| `AGENTAGE_STORE_URL_FILE` | the estate's store (G1, G2): a file with a `postgres://` URL for a postgres store, an `http://` URL for a clickhouse store. Set, the host opens it in place of PGlite (never both); see [Estate stores in the host](#estate-stores-in-the-host)                                                                                                                                                                                                                                                                                          |
| `AGENTAGE_HOST_BIND=all`  | listen on every address. It needs a token check (`AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_ORIGIN`) or `AGENTAGE_HOST_AUTH=off`                                                                                                                                                                                                                                                                                                                                                                                                  |
| `AGENTAGE_USER_SUB`       | set by the daemon from the signed-in cli (`auth.json`: the platform token of its `issuer`, else the issuer's get-session for the session bearer; no `issuer`, no user). On loopback every request acts as this user with `{id}:read` and `{id}:write`; an admin route stays anonymous. Trust: any local process that reaches the port acts as the user (browsers are blocked by the Host and Origin guard). The daemon reads `auth.json` every `userPollMs` (2 s): a sign-in or sign-out restarts the running children. Unset: no caller |

The one container (`build --container`) sets `AGENTAGE_HOST_BIND=all`, `PORT=8080` and
`AGENTAGE_DRAIN_MS=8000`. With a postgres or git store it also sets `AGENTAGE_DATA_DIR=/data/store` on
the volume `/data`; a git store also installs `git`. So it needs the token values, or
`-e AGENTAGE_HOST_AUTH=off` for a local run.
`/health` answers on loopback only: use `docker exec` or the `HEALTHCHECK` state.

```bash
docker run -p 8080:8080 -e AGENTAGE_HOST_AUTH=off -v probe-data:/data ghcr.io/agentage/probe:0.7.0
```

- Any `AGENTAGE_HOST_BIND` other than `all` binds loopback with no token check. With
  `--network host` that is the loopback of the machine.
- The drain ends within 8 s, under the 10 s of `docker stop`. A longer drain needs both a higher
  `AGENTAGE_DRAIN_MS` and `docker run --stop-timeout <s>`.
- `--read-only` works: only `/data` is written, and `/tmp` needs no tmpfs.

### Estate stores in the host

With `AGENTAGE_STORE_URL_FILE` set, the host (the one container, `serveHost`, `hostExtension(dir, {
storeUrlFile })`) opens the store of the estate:

| Store kind   | The file holds                    | The host                                                                                                                                                                  |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres`   | `postgres://user:pw@host:5432/db` | a `pg` pool as `ctx.store`; it never migrates: `checks["store:migrations"]` is `unavailable` until the migrate job ran                                                    |
| `clickhouse` | `http://user:pw@host:8123/db`     | a client over the HTTP interface as `ctx.store`; `clickhouseOf(ctx)` gives `query`, `command`, `insert`, `ping`                                                           |
| `git`        | `http://root:pw@host:8080/root/`  | the repos stay in `AGENTAGE_DATA_DIR` (`ctx.store.gitRoot`); `ctx.store.git.remote` (no credential) is the push remote, the credential is a header in `ctx.store.git.env` |

- Unset: a postgres store is PGlite in `AGENTAGE_DATA_DIR`, as before. The daemon does not pass the
  variable to its children.
- A missing or empty file, or a URL of the wrong scheme, stops the start. The error names the
  variable and the file, never the URL.
- A store that is down does not stop the start: the host waits `AGENTAGE_STORE_OPEN_MS`, then
  serves, and `/health` is 503 until the store answers.
- `/health` keeps `checks.store` and adds `checks["store:postgres"]`, `checks["store:clickhouse"]` or `checks["store:git"]`
  (one probe answers both), so a reader sees which store answered. A PGlite store has
  `checks.store` only.
- A package with another store kind (or none) logs a warn and ignores the file.

#### The migrate job (contract for the estate)

The same image runs the migrations as a one-shot job, before the service update:

|         |                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command | `node node_modules/@agentage/extension/dist/host/main.js migrate` (the image's `WORKDIR` is the package)                                                                                                        |
| Env     | `AGENTAGE_STORE_URL_FILE` (the service's own file); `AGENTAGE_EXTENSION_DIR` only when the package is elsewhere                                                                                                 |
| Exit 0  | the kit and package migrations, then the seeds once, are applied; stdout is one JSON line `{"migrations":n,"applied":n,"seeds":n,"seedsBefore":n}`. A package with no postgres store exits 0 with nothing to do |
| Exit 1  | no variable, a bad file, a store that cannot be reached, or a failing migration (named in the JSON log on stderr). The URL is never printed                                                                     |
| Limits  | 10 s to connect, 5 min a statement; no retry inside the job                                                                                                                                                     |
| Run     | a Swarm `replicated-job` with one replica, then the service update; a rerun applies nothing new                                                                                                                 |

The serving container does not migrate: until the job ran, `checks["store:migrations"]` is
`unavailable` (503) and a warn line names the pending files. Once the ledger holds every file of
the image, the check stays `ok`. The local daemon is not changed: its PGlite store migrates when it
opens.

```bash
docker run --rm -e AGENTAGE_STORE_URL_FILE=/run/secrets/store-url \
  -v ./store-url:/run/secrets/store-url:ro ghcr.io/agentage/probe:0.8.0 \
  node node_modules/@agentage/extension/dist/host/main.js migrate
```

#### A clickhouse store

```ts
import { clickhouseOf, type ApiCreate } from '@agentage/extension';

export const create: ApiCreate = (ctx) => {
  const ch = clickhouseOf(ctx);
  return async (req, res) => {
    const { rows } = await ch.query('SELECT count() AS n FROM events WHERE kind = {kind:String}', {
      kind: String(req.query.kind),
    });
    res.json(rows);
  };
};
```

A store that cannot be reached, a server timeout (`159`), too many queries (`202`), a proxy
502-504 with no ClickHouse code and a socket closed mid-answer are `UNAVAILABLE` (503). Any other
ClickHouse error keeps its own code on `err.code` (`60` no table, `243` no space). Pass `insert_deduplication_token` in `settings` so a
retried batch is a no-op. A `Date` parameter goes as epoch seconds; one with milliseconds needs a `DateTime64(3)`
parameter. A read waits for the whole answer (`wait_end_of_query`), so a late error is an error,
not a row.

`localOnly(port)` from `@agentage/extension/host` is the guard of the daemon, as Express middleware.
A request needs the Host `127.0.0.1` or `localhost` at that port (`[::1]` is refused: nothing
listens there), no other Origin, and no cross-site `Sec-Fetch-Site`, or it throws a 403
`FORBIDDEN` for the error handler. With no port given, it compares against the port of the socket
the request came in on. `hostExtension(dir, { localOnly: true })` mounts it before every route, at
the port of the socket. A client checks support with `capabilities` from `/tool` or `/host`:
`container` (`build --container`), `localOnly`, `installDisabled` (`POST /host/extensions` takes
`enabled: false`), `updateInstallation` and `withFileLock` (the exports below).

On loopback there is no token check. SIGTERM drains the open requests, waits for a job run still
going (3 s at most), closes the store and exits 0. `ctx.exit()` does the same. The host brings `@electric-sql/pglite`; the package does not
need it.

The daemon (`createDaemon`) answers `/api/{id}/*` from the child of that extension. It answers 404
`NOT_FOUND` for an id that is not installed or is disabled; a client does not retry it. It answers
503 `UNAVAILABLE` with `Retry-After` while the extension is starting or failed, or when a request
waited past `gateMs` for a change to end. The message is "<id> is starting | failed | changing: try
again", or "the daemon stops" once `stop()` began. A child that sends no answer headers in `answerMs` gets
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
409 `INSTALLATION_UNREADABLE` ("not JSON") until it is fixed. A `settings.json` or `secrets.json` that is not JSON,
or not an object of rows by id, is never written. Each change that reads it is 409
`SETTINGS_UNREADABLE` or `SECRETS_UNREADABLE`, with `details: { file, reason }`. A start that reads
it fails with that message. The reason is fixed words, never the file text. A daemon file that
cannot be written (`ENOSPC`, `EDQUOT`, `EROFS`, `EACCES`, `EPERM`) is 503 `UNAVAILABLE`. The
message names the file and the errno, and no temp file stays. A write that finds a daemon file
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
exits restarts after `backoffMs`, by the restarts since the last reset: in a tight loop the steps
are 1, 2, 4 and 8 s, and the 5th exit in `crashWindowMs` (10 min) is `failed`; 16 s is the cap for
later exits, once older exits left the window. A restart that does not start counts as an exit.
`failed` reads `exited 5 times in 10 min: <last words>`, with no more restarts. While it waits the
state is `starting`, the error `<last words>: restart in <ms> ms`. The last words are the last
stderr line that says why (an error line, an error log row's msg, or the thrown text; stack frames,
error properties, blank lines and the `Node.js v` line are skipped). Each secret value of 4 or
more characters that the child was given reads `***` there, in `/health`, the list and the log. A
`PATCH` that starts it (enable, configure, update), a reload, or `healthyResetMs` (10 min) healthy
on one child resets the count. A restart runs in the change queue; a change, remove or stop
cancels it. A store open that finds the data lock held by a live process retries every 100 ms up
to the open limit, then fails as before; on Linux a holder in state `Z` (exited, not reaped) is dead.

Reload (D14). `POST /host/extensions/{id}/reload`, body `{}`, for a folder row only (a market row
is 400 `VALIDATION_ERROR`, a disabled one 409 `CONFLICT`, an unreadable `installation.json` 409
`INSTALLATION_UNREADABLE`). In the change queue (a second reload waits): requests wait at the gate
(`gateMs`), the child stops and its exit is awaited, `dist` is renamed to `dist.prev` and
`dist.next` is COPIED to `dist` (with no `dist.next` it restarts on `dist`), the new child starts
and must be healthy. Then 200 `{ id, version, state, pid, reloaded: true }`; the removal of
`dist.prev` and of the marker after that is best-effort (a warn line). `dist.next` is the
watcher's tree: the daemon never moves or deletes it. Not healthy: the copied `dist` goes,
`dist.prev` comes back, the last good build starts, 200 `{ ..., reloaded: false, refused: "<why>" }`;
the store rows stay. A rename or copy that fails (`EPERM`, `EBUSY`) answers the same way, not a 500.
`run/{id}/reload.json` records the folder and is written before the swap, removed after, and on a
remove of the id. At boot a marker of the row's own folder with a `dist.prev` is a cut reload: the
partial `dist` goes and `dist.prev` comes back; with no `dist.prev`, `dist` is never touched. A
reload exit is not a crash exit.

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
| `healthyResetMs`              | `600000`                          | a child healthy this long has its restart count reset                                   |

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

## The daemon: routes, host token, seal

| Route                                 | Answer                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANY /api/{id}/*`, `ANY /mcp/{id}`    | the child of that id, path kept; 404 envelope not installed or disabled; 503 `Retry-After: 5` not running                                                                                                        |
| `GET /.well-known/agentage-host.json` | `{ host: "local", shell?: { package, version }, extensions: [{ id, version, parts, app? }] }` of the running extensions; `app` = `{ title, icon?, order?, entry, css }` of an enabled, built app part; anonymous |
| `GET /health`                         | each entry adds `parts`, `seal` (`on`/`partial`/`off`), `restarts`; below the Node floor `seal: "off"`, `sealError`, `status: "degraded"`                                                                        |
| `/host/*`                             | `Authorization: Bearer <hostToken>`: 401 `UNAUTHORIZED` with none, 403 `FORBIDDEN` with another                                                                                                                  |

| `GET /`, `GET /{id}/*` | for a client that prefers HTML: the shell `index.html` (`no-cache`), 404 when `id` has no app; others get the JSON 404 |
| `GET /shell/*` | the kit's own `dist/shell` (the kit build writes it), or the `dist/` of the `shellDir` option; neither, no page and no `shell` key |
| `GET /shell/session` | `{ user: { id, email?, name? } \| null, host: "local" }`: `id` is the user the children run as (issuer checked, as the cli does), `email` and `name` from that `auth.json`; never a token |
| `GET /shell/events` | server-sent events: `extensions` after each change, `app { id, entry, css }` after an app reload |
| `GET /app/{id}/*` | the package's `dist/app`, also while the child is down; hashed files `immutable`, `index.js` and `app.json` `no-cache` |

`X-Agentage-App: <id>` on `/api/{other}/*`, `/files/{other}/*` or `/connector/{other}` is 403 `FORBIDDEN`: an app calls only its own
extension. The header is self-declared, so it is a guard against mistakes, not a boundary: a
request with no header, or with a false one, is not stopped. `POST /host/extensions/{id}/reload` with body
`{ "part": "app" }` restarts no child: it reads `dist/app/app.json` and sends the `app` event.

`hostToken` is new at each daemon start and is only in `daemon.json` (0600). The proxy drops an
`Authorization` that carries it, so no child sees it.

A child is forked with `node --permission --no-experimental-sqlite`. It may read the `node_modules`
that holds the kit and the tree of its package (a folder row: the folder). It may read and write
`run/{id}` and `data/{id}`. It gets no child-process, worker, addon or WASI grant, with one
exception: a package with `store: git` gets `--allow-child-process`, because its part runs `git`
(PD2). Its entry in `/health` says `seal: "partial"`; the daemon status stays `ok`. The `git`
process runs outside the permission model: it can read and write any path the user can. The grant
is not limited to `git`: the child may start any program (`sh`, `cat`), so for code the seal of this
child is off. This is accepted for first-party extensions only (memory). Before a third-party
extension installs from the market, the grant gets an allowlist (an installation flag or host
config) and the install shows `seal: partial`. A symlinked
path is granted as given and as its real path. A kit checkout grants its package and its workspace
root, never a folder above the user's home.

A read grant that is the config folder, holds it, or is inside it (other than a cli tree in
`extensions/trees`) refuses the start: `seal: the folder <path> would expose the agentage config
folder`. A grant with a `*` refuses the start too, because Node reads it as a wildcard.

The secrets the package declares go to `run/{id}/secrets` (0600 files, 0700 folder). They are
removed once the child reports its port. `TMPDIR` is `run/{id}/tmp`. The seal is on from Node
22.22.2 (22.x), 24.14.1 (24.x) and on each even major above 24; an odd major is off. Below the
floor the child still gets the flags where Node has `--permission` (22.13.0, 23.5.0, 24.0.0 and
newer), and `/health` says `seal: "off"`. Older Node starts the child with no flags.

Before the fork the daemon removes an old `data/{id}.lock` of a dead pid; a live one refuses the
start. It also removes a `run/{id}/store.lock` that no child of this id holds (a dead or reused
pid). A start that throws before the port removes the folders it made.

Limits: Node calls the permission model a seat belt, not a defence against hostile code. A symlink
placed from outside the seal is followed. The network is open.
