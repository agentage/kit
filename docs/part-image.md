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

`@agentage/extension/host` exports `hostExtension(dir, opts)`. It serves the api part of the
package in `dir` at `/api/{id}/*`. The daemon child and the one container run the entry
`node node_modules/@agentage/extension/dist/host/main.js`.

| Env                      | Meaning                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | the port, `8080` by default; `0` lets the OS pick, and the port goes to the parent over IPC                                             |
| `AGENTAGE_EXTENSION_DIR` | the package folder, the current folder by default                                                                                       |
| `AGENTAGE_DATA_DIR`      | the PGlite folder of a postgres store; `<dir>.lock` holds the pid. Unset: in memory, a warn line                                        |
| `AGENTAGE_SETTINGS`      | JSON of setting values over the manifest defaults                                                                                       |
| `AGENTAGE_SECRETS_DIR`   | one file per declared secret, `/run/secrets` by default                                                                                 |
| `AGENTAGE_ORIGIN`        | `ctx.extension.origin`, `http://127.0.0.1:<PORT>` by default                                                                            |
| `AGENTAGE_DRAIN_MS`      | how long SIGTERM may drain before exit 1, `10000` by default                                                                            |
| `AGENTAGE_HOST_BIND=all` | listen on every address. It needs a token check (`AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_ORIGIN`) or `AGENTAGE_HOST_AUTH=off` |

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
A request needs the Host `127.0.0.1` or `localhost` at that port (`[::1]` is refused: nothing listens there), no other Origin, and no
cross-site `Sec-Fetch-Site`, or it throws a 403 `FORBIDDEN` for the error handler. With no port
given, it compares against the port of the socket the request came in on.
`hostExtension(dir, { localOnly: true })` mounts it before every route, at the port of the socket.
A client checks support with `capabilities` from `/tool` or `/host`: `container` (`build
--container`), `localOnly`, `installDisabled` (`POST /host/extensions` takes `enabled: false`) and
`updateInstallation` (the export below).

On loopback there is no token check. SIGTERM drains the open requests, closes the store and
exits 0. `ctx.exit()` does the same. The host brings `@electric-sql/pglite`; the package does not
need it.

The daemon (`createDaemon`) answers `/api/{id}/*` from the child of that extension. It answers 404
`NOT_FOUND` for an id that is not installed or is disabled; a client does not retry it. It answers
503 `UNAVAILABLE` with `Retry-After` while the extension is starting or failed, or when a request
waited past `gateMs` for a change to end. A child that sends no answer headers in `answerMs` gets
504 `UNAVAILABLE` ("The extension did not answer in <ms> ms").

`POST /host/extensions` with `enabled: false` records the extension (the installer runs for an
`{ id }`) and never starts it; a later `PATCH { enabled: true }` starts it with no second installer
call. When `installation.json` cannot be read (`EACCES`, `EISDIR`), the daemon never writes it:
`/health` says `installation: "unreadable"` and `installationError`, and each change is 409
`INSTALLATION_UNREADABLE` until the file is fixed and the daemon restarted. A write that finds a
daemon file locked by another live process waits `lockMs`, then is 503 `UNAVAILABLE` naming the
pid ("installation.json is locked by process <pid>: waited <ms> ms"). `updateInstallation(configDir,
change)` from `/host` is that same read, change and write under the lock; it refuses a row C3
refuses or an id twice. The data lock falls back to an exclusive create on a volume with no hard
links.

Each wait of the daemon has a bound, a `createDaemon` option:

| Option      | Default  | Bounds                                                                                  |
| ----------- | -------- | --------------------------------------------------------------------------------------- |
| `startMs`   | `60000`  | a forked child's port report; then `SIGKILL`, "reported no port in <ms> ms: killed"     |
| `healthMs`  | `60000`  | a new child's own `/health`                                                             |
| `drainMs`   | `10000`  | the open requests of an old child before it stops (then `SIGTERM`, `SIGKILL` after 5 s) |
| `gateMs`    | `30000`  | a request held while its extension swaps children; then 503                             |
| `answerMs`  | `60000`  | a child's answer headers; then 504                                                      |
| `lockMs`    | `5000`   | a write waiting for another process's lock of a daemon file; then 503                   |
| `installMs` | `120000` | one `Installer` call; then 504 (at boot: that entry is failed)                          |

The daemon (`createDaemon`) answers `/health` with `service: "agentage-daemon"`, `pid`, `version`
and `protocol`, the values of `daemon.json`, so a client can prove which process it talks to. A
`PATCH {settings}` string becomes the type the manifest declares (`"5"` to `5`, `"true"`); any
other value, or an undeclared key, is `400 INVALID_SETTING`. An `Installer` error with a string
`code` (and `status` 400, 404 or 502) is the client's error; any other error is a logged `500`.
The daemon calls the `Installer` again on every boot, once for each entry with a version, one at a
time, after the folder entries. So it must be idempotent and fast for a version that is already
installed. Its spec carries a `signal`, aborted when the daemon stops waiting (`installMs`); an
installer that ignores it keeps running, and a later call can then overlap it.
