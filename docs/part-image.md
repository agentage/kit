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

`hostExtension(dir, { localOnly: true })` mounts the guard of the daemon before every route. A
request needs the Host `127.0.0.1:<port>` or `localhost:<port>`, no other Origin, and no cross-site
`Sec-Fetch-Site`, or it gets 403. A client checks support with `CAPABILITIES` from
`@agentage/extension/tool` (`container`, `local-guard`).

On loopback there is no token check. SIGTERM drains the open requests, closes the store and
exits 0. `ctx.exit()` does the same. The host brings `@electric-sql/pglite`; the package does not
need it.

The daemon (`createDaemon`) answers `/api/{id}/*` from the child of that extension. It answers 404
`NOT_FOUND` for an id that is not installed or is disabled; a client does not retry it. It answers
503 `UNAVAILABLE` with `Retry-After` while the extension is starting or failed, or when a request
waited past 30 s for a change to end.

The daemon (`createDaemon`) answers `/health` with `service: "agentage-daemon"`, `pid`, `version`
and `protocol`, the values of `daemon.json`, so a client can prove which process it talks to. A
`PATCH {settings}` string becomes the type the manifest declares (`"5"` to `5`, `"true"`); any
other value, or an undeclared key, is `400 INVALID_SETTING`. An `Installer` error with a string
`code` (and `status` 400, 404 or 502) is the client's error; any other error is a logged `500`.
