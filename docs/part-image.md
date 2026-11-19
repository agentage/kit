# Run a part image

A part image is the container image `build` makes for one part. A deployment sets these values
when it runs the image. The audience (`AGENTAGE_AUDIENCE`) is the host a token is valid for: one host, or `*.{domain}`.

| Setting                                                   | Meaning                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Entry                                                     | `node node_modules/@agentage/extension/dist/runtime/main.js <part>`; port `3000` (`PORT` overrides)                                  |
| `/api/{id}/*`, `/api/v1/*`                                | the api part's routes; the `/api/v1` prefix stays during the move                                                                    |
| `/health`                                                 | loopback only (the container `HEALTHCHECK`, an operator on the node); `404` from any other address                                   |
| `/.well-known/agentage-extension.json`                    | the record at `/run/agentage/agentage-extension.json` (`AGENTAGE_RECORD_FILE`), the host, `serves` and `app` ([below](#discovery))   |
| `AGENTAGE_ORIGIN`                                         | the deployment's origin; pages and ui take it from the request without it                                                            |
| `AGENTAGE_SETTINGS`                                       | JSON of setting values over the manifest defaults                                                                                    |
| `AGENTAGE_STORE_URL` / `_FILE`                            | the store, opened as in the host ([Estate stores](#estate-stores-in-the-host)); postgres also takes the URL or libpq `PG*` variables |
| `AGENTAGE_DATA_DIR`, `AGENTAGE_RUN_DIR`                   | a git store: its repos (`/data/store` in the image, with `git`) and the folder of its store lock                                     |
| `AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_ORIGIN` | required for api and mcp. Without them the part does not start. It also does not start when its host is not in the audience.         |
| `AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE` on pages           | CSP script-src, connect-src add these hosts; helmet's style-src keeps 'unsafe-inline'                                                |
| `AGENTAGE_TELEMETRY_URL`                                  | `ctx.platform.telemetry` (with `issuer`, `audience`; a value a part lacks is `''`)                                                   |
| `AGENTAGE_DEV_ISSUER`                                     | set by `up` for the ui part only: its CSP then lets the harness reach the dev issuer                                                 |
| `Cookie` request header                                   | dropped before any handler; a part sets no cookie and its CORS carries no credentials                                                |

## Discovery

The discovery document says what this container serves. `serves` lists its part kinds; a host
lists every part it runs, and `app` when it serves the app bundle. `app` is then the nav row:
`{ title, icon?, order?, entry, css }`. The schema is strict, so a reader on an older kit refuses
the new keys. With no record mounted, a part lists its image only by digest; with an image by tag
it lists `{}`, as a host does.

An app host combines these documents and its installation into
`/.well-known/agentage-host.json`: `host`, `kind`, `shell` and one entry for each installed id.
`combineHost` (`@agentage/extension/contracts`, also `/host`) does it with no I/O and also gives the route table. An
id with no valid answer is `down` and has no route. A part routes only when a container serves it
and the installation exposes it. An answer for an id that is not installed is refused, and so is a second pages route. The caller can
set a row to `starting` or `failed`; with its last good document the entry keeps its `app` row and
has no route. A document with an old `/api/v{N}` openapi is refused, and so is a tool that is not
`{id}__{name}` of its own id. An answer can carry `expectedId`, the id its container was listed for;
an answer for another id is refused as `claims another id`. A bad answer never throws. Only an
installation that gives an invalid host document (two rows of one id) throws.

JSON Schemas for the manifest, the build record, the discovery document, the host document,
`/health` and the envelope are in [`packages/extension/schemas`](../packages/extension/schemas). Regenerate them with
`npm run build && npm run schemas`.

## Host one extension

`@agentage/extension/host` exports `hostExtension(dir, opts)`. It runs every server part of the
package in `dir` on one app and one port: the api at `/api/{id}/*`, the mcp at `/mcp/{id}` and
the worker jobs. The parts share one store and one `/health`, which lists them in `parts`. The
jobs start after every `create` and stop before the store closes. With no token check,
`tools/list` is open. On `127.0.0.1` the host accepts only a local Host and Origin, at its own
port or at the port of `AGENTAGE_ORIGIN`. The daemon child and the one container run the entry
`node node_modules/@agentage/extension/dist/host/main.js`.

| Env                                                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                           | the port, `8080` by default; `0` lets the OS pick, and the port goes to the parent over IPC                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `AGENTAGE_EXTENSION_DIR`                                         | the package folder, the current folder by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AGENTAGE_DATA_DIR`                                              | the PGlite folder of a postgres store; `<dir>.lock` holds the pid. Unset: in memory, a warn line                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `AGENTAGE_RUN_DIR`                                               | the daemon's `run/{id}`: the store lock is `run/{id}/store.lock` there in place of `<dir>.lock`. Unset (the one container): `<dir>.lock`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `AGENTAGE_SETTINGS`                                              | JSON of setting values over the manifest defaults                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AGENTAGE_SECRETS_DIR`                                           | one file per declared secret, `/run/secrets` by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `AGENTAGE_ORIGIN`                                                | `ctx.extension.origin`, `http://127.0.0.1:<PORT>` by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_TELEMETRY_URL` | `ctx.platform` (`issuer`, `audience`, `telemetry`), as in a part image; a value it lacks is `''`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `AGENTAGE_DRAIN_MS`                                              | how long SIGTERM may drain before exit 1, `10000` by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `AGENTAGE_STORE_OPEN_MS`                                         | how long the store may take to open (and to close), `120000` by default; then the api starts and `/health` says the store is `unavailable` until it opens. Under the daemon it is the daemon's `healthMs` (raise both with `createDaemon({ healthMs })`, and `startMs` with it)                                                                                                                                                                                                                                                          |
| `AGENTAGE_STORE_URL_FILE`                                        | the estate's store: a file with a `postgres://` URL for a postgres store, an `http://` URL for a clickhouse store. Set, the host opens it in place of PGlite (never both); see [Estate stores in the host](#estate-stores-in-the-host)                                                                                                                                                                                                                                                                                                   |
| `AGENTAGE_HOST_BIND=all`                                         | listen on every address. It needs a token check (`AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_ORIGIN`) or `AGENTAGE_HOST_AUTH=off`                                                                                                                                                                                                                                                                                                                                                                                                  |
| `AGENTAGE_USER_SUB`                                              | set by the daemon from the signed-in cli (`auth.json`: the platform token of its `issuer`, else the issuer's get-session for the session bearer; no `issuer`, no user). On loopback every request acts as this user with `{id}:read` and `{id}:write`; an admin route stays anonymous. Trust: any local process that reaches the port acts as the user (browsers are blocked by the Host and Origin guard). The daemon reads `auth.json` every `userPollMs` (2 s): a sign-in or sign-out restarts the running children. Unset: no caller |

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

With a token check, the part reads the issuer's revoked list
(`/.well-known/agentage-revoked`) at start and every 30 s, so a revoke holds within 60 s. A token
with a `jti` gets 503 `UNAVAILABLE` (with `Retry-After`) until the first read, and a revoked one gets 401. When the last good read is over 5 minutes old, the list is stale: a call that needs `write` or
`admin` gets 503 `UNAVAILABLE`, and a read still uses the stale list. A token without the scope
gets 403 first. `/health` says `degraded` while the list is stale.

On loopback there is no token check. SIGTERM drains the open requests, waits for a job run still
going (3 s at most), closes the store and exits 0. `ctx.exit()` does the same. The host brings `@electric-sql/pglite`; the package does not
need it.

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
- A part image (`dist/runtime/main.js <part>`) listens at once and is 503 until the store answers.
  Its `checks["store:migrations"]` is there only when the part has `migrations/`, and pending
  migrations are `degraded` (200): an app host with no migrate job keeps serving.
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

The local daemon (`createDaemon`) has its own page: [daemon.md](daemon.md).
