# S1.1.2 B0 spike: children under the Node permission model

Evidence only, not for merge. Date 2026-11-16. Kit `@agentage/extension` 0.14.0 from the `@agentage/cli` 0.52.0 install, PGlite from the same `node_modules`. Packages installed like the cli does: one npm tree per version at `<cfg>/extensions/trees/<id>@<version>/` (`npm install --prefix --ignore-scripts`). The child is `node <flags> <cli>/node_modules/@agentage/extension/dist/host/main.js` with the C2 env, IPC `ready`, then the first 200 on its api route.

Files: `harness.mjs` (fork, time, RSS), `deny.mjs` (the denied-read matrix with the `spy` fixture), `deep.mjs` (every route of a probe), `bench.sh` (5 runs per row), `fixture-spy/` (route `GET /api/spy/read?how=&path=`; `dist/` is force-added), `raw/` (outputs, home paths replaced by `<B>`).

Nodes: 24.6.0 (the machine default, below the seal floor), 22.23.2, 24.22.1 and 22.12.0 (the last two installed through nvm for this spike, removed after it).

## Verdict on D2

**Holds with changes to C2.** The seal stops every plain `node:fs` read of another extension's files and of `secrets.json`, `settings.json`, `installation.json`, `daemon.json` (table below). Three changes are needed:

1. **The store lock is a sibling of the data folder.** The kit writes `<dataDir>.lock` and `<dataDir>.lock.<pid>.<hex>` (`host/data-lock.ts`), outside `data/{id}`: probe 0.7.0 and 0.6.2 exit at start with `ERR_ACCESS_DENIED` (`writeFile` in `data-lock.js`). A grant for `data/{id}.lock*` is not a fix: with it, `mkdir -p data/{id}` is denied on 22 and 24 (a grant with the same prefix breaks the grant of the folder). Fix used here: `AGENTAGE_DATA_DIR=<cfg>/data/{id}/store`, the grant stays `data/{id}`, the lock falls inside it. Other fix: the kit puts the lock inside a folder the child owns (`run/{id}/store.lock`). Pick one (owner); the first moves existing data of S1.1.1 machines, the second is a kit change.
2. **`node:sqlite` is not covered by the permission model** (22.23.2, 24.6.0, 24.22.1): a sealed child opens any file and creates and writes a SQLite file in another extension's folder. `--no-experimental-sqlite` closes it (import fails with `ERR_UNKNOWN_BUILTIN_MODULE`); the kit and PGlite do not use `node:sqlite`.
3. **The read grant can be the tree, not all of `extensions/`.** The package's own dependencies (express, zod) live in `extensions/trees/<id>@<version>/node_modules`; the package dir alone is not enough; `extensions/` is more than needed (other packages' code).

Stated limits that stay (add to D2):
- A symlink inside the child's own folder that points out is followed: the seal checks the path given, not the target. The child cannot make one (`symlinkSync` and `linkSync` are denied), but anything outside the seal that puts one there (the user, a restore) opens the target to the child.
- `realpathSync` answers for any path (an existence and path oracle, no content) on 22.23.2 and 24.6.0; `realpathSync.native` also on 24.6.0. All closed on 24.22.1. The C2 floor (22.22.2, 24.14.1) blocks content reads; it does not close the oracle until 22.23.4 or 24.22.1 (owner decision).
- The network is open: a sealed child gets 200 from a local server standing in for `/host/extensions` (D11's host token is needed).
- mcp, worker and ui parts did not run in the child: the 0.14 host child mounts only api and the store (`host-extension.ts` calls `RUNNERS.api`; `/mcp` and `/ui/...` are 404). C4 must rerun this check.

## (a) Start under the flags

| Package | api route | Seal on (24.22.1, 22.23.2, 24.6.0) |
|---|---|---|
| probe 0.7.0 (kit 0.14, store) | `/api/probe/echo`, `/api/probe/ticks` (store query), `/health` | 200 after change 1 |
| probe 0.6.2 (kit 0.12) | same | 200 after change 1 |
| spy fixture | `/api/spy/read` | 200 |

Grants, ablation (drop one at a time, 24.22.1):

| Grant | Needed | Why |
|---|---|---|
| read `<cli>/node_modules` | yes | kit main, express, zod, MCP SDK, PGlite and its wasm and data files |
| read `<package dir>` | no, if the tree is granted | covered by the tree |
| read `extensions/` (or the tree) | yes | the package's own `node_modules` |
| read+write `run/{id}` | not for start | C3 secrets folder and `TMPDIR` (`os.tmpdir()` follows `TMPDIR`, write works) |
| read+write `data/{id}` | yes for a store | PGlite files, the lock (change 1) |

`ERR_ACCESS_DENIED` met: only the lock (change 1). Not needed and denied: `/proc/self/*`, `/etc/ssl`, `/usr/share/zoneinfo`. Timezone (`TZ=Europe/Prague`), HTTPS with the system CA and `os.cpus()` work with no grant (native code, not `node:fs`). Symlinks and `realpath` in the npm tree: none met (npm copies files; no `.bin` link is read).

## (b) Denied reads (sealed spy child)

Targets: `secrets.json`, `settings.json`, `installation.json`, `daemon.json`, `data/other/x.txt`, `run/other/token`. Same answer for all six.

| Way | 24.6.0 | 22.23.2 | 24.22.1 |
|---|---|---|---|
| `readFileSync`, relative path, `fs.promises`, stream, `openSync`, `statSync`, `existsSync` | denied | denied | denied |
| `../..` traversal (normalized and raw string), `Buffer` path, `URL` path | denied | denied | denied |
| `import ... with {type:'json'}`, `createRequire`, `process.loadEnvFile`, `fs.openAsBlob`, `fs.watch` | denied | denied | denied |
| `/proc/self/root/<path>` | denied | denied | denied |
| `symlinkSync` (absolute, relative) and `linkSync` into own folder | denied at link | denied at link | denied at link |
| `copyFileSync`, `renameSync` into own folder, `writeFileSync` on target | denied | denied | denied |
| `opendir`, `readdir` of `data/other`, `run/other`, `<cfg>` | denied | denied | denied |
| `realpathSync` | path, no content | path, no content | denied |
| `realpathSync.native` | path, no content | denied | denied |
| symlink made outside the seal in own folder, then read | **read** | **read** | **read** |
| `node:sqlite` `DatabaseSync` (open; write a new file in `run/other`) | **opened, wrote** | **opened, wrote** | **opened, wrote** |
| same with `--no-experimental-sqlite` | module missing | module missing | module missing |
| `spawnSync('cat')`, `new Worker` | denied | denied | denied |

Id prefixes do not leak: a grant for `run/spy` denies `run/spy2/` and `run/spy.lock`.

## (c) Other permission flags

None needed for api + store: PGlite runs as in-process WebAssembly (no `--allow-wasi`, no `--allow-worker`); no addon; nothing spawns. Static scan: in the kit only `host/daemon/child.js` and `tool/exec.js` import `child_process` (not loaded in the child); the MCP SDK server files do not. `--permission-audit` (24.22.1) prints nothing to stderr, so it cannot list swallowed denials.

## (d) Start time and RSS (fork to first 200; RSS 1.5 s after it; 5 runs; median (min-max))

First = empty data folder (PGlite initdb). The machine was shared with other sessions during the runs.

| Node | Package | Seal | Start | ms | RSS MB |
|---|---|---|---|---|---|
| 24.22.1 | probe 0.7.0 | off | first | 1715 (1699-1741) | 533 (510-541) |
| 24.22.1 | probe 0.7.0 | on | first | 1726 (1712-1781) | 512 (489-539) |
| 24.22.1 | probe 0.7.0 | off | warm | 616 (600-663) | 376 (375-376) |
| 24.22.1 | probe 0.7.0 | on | warm | 621 (606-656) | 375 (374-376) |
| 24.22.1 | probe 0.6.2 | off | first | 1723 (1682-1825) | 524 (514-533) |
| 24.22.1 | probe 0.6.2 | on | first | 1768 (1728-2102) | 539 (484-571) |
| 24.22.1 | probe 0.6.2 | off | warm | 623 (606-659) | 375 (375-376) |
| 24.22.1 | probe 0.6.2 | on | warm | 631 (608-644) | 375 (374-376) |
| 24.22.1 | spy | off | warm | 278 (269-283) | 104 (102-104) |
| 24.22.1 | spy | on | warm | 285 (269-325) | 104 (101-105) |
| 22.23.2 | probe 0.7.0 | off | first | 1656 (1612-1673) | 581 (527-727) |
| 22.23.2 | probe 0.7.0 | on | first | 1715 (1672-1794) | 556 (525-726) |
| 22.23.2 | probe 0.7.0 | off | warm | 637 (609-649) | 354 (335-376) |
| 22.23.2 | probe 0.7.0 | on | warm | 625 (602-684) | 354 (339-376) |
| 22.23.2 | probe 0.6.2 | off | first | 1698 (1670-1769) | 535 (515-727) |
| 22.23.2 | probe 0.6.2 | on | first | 1711 (1680-1925) | 697 (526-751) |
| 22.23.2 | probe 0.6.2 | off | warm | 624 (592-649) | 354 (337-359) |
| 22.23.2 | probe 0.6.2 | on | warm | 700 (675-751) | 354 (352-360) |
| 22.23.2 | spy | off | warm | 261 (244-289) | 95 (94-98) |
| 22.23.2 | spy | on | warm | 265 (252-273) | 95 (94-95) |

The seal adds 0 to 3 % start time (one row 12 %) and no RSS. All rows are in `raw/bench.jsonl` (spy "first" rows too). The last 22.23.2 probe 0.6.2 rows ran with `--no-experimental-sqlite` added.

## (e) Network

Yes: the sealed child fetched `http://127.0.0.1:<port>/host/extensions` from a stand-in server and got 200 on every Node. The seal does not cover the daemon routes; D11 is needed.

## (f) Below the floor

- Node 22.12.0: `--permission` is `bad option`, the child exits before any code (exit 9). The old spelling `--experimental-permission` works there, and on 22.23.2; 24.x rejects it. So the daemon must check `process.versions.node` before the fork: below 22.13.0 fork with no flags; between 22.13.0 and the floor fork with the flags and report `seal: off` (known bypasses).
- Detection in the child: `typeof process.permission?.has === 'function' && !process.permission.has('fs.read', '<configDir>/secrets.json')` means sealed; the daemon adds the version floor check.
- This machine's default Node (24.6.0) is below the floor: `realpathSync.native` answers there (CVE-2026-21715).

## New C2 block (proposal)

```text
node --permission --no-experimental-sqlite
     --allow-fs-read=<the node_modules that holds the kit, express, zod, the MCP SDK and PGlite (in the cli install)>
     --allow-fs-read=<configDir>/extensions/trees/<id>@<version>
     --allow-fs-read=<configDir>/run/{id}  --allow-fs-write=<configDir>/run/{id}
     --allow-fs-read=<configDir>/data/{id} --allow-fs-write=<configDir>/data/{id}
     <kit>/dist/host/main.js
not given: --allow-child-process  --allow-worker  --allow-addons  --allow-wasi
env:  PATH HOME LANG NODE_EXTRA_CA_CERTS   TMPDIR=<configDir>/run/{id}/tmp
      PORT=0 AGENTAGE_EXTENSION_DIR AGENTAGE_DATA_DIR=<configDir>/data/{id}/store
      AGENTAGE_SETTINGS AGENTAGE_SECRETS_DIR=<configDir>/run/{id}/secrets AGENTAGE_ORIGIN
      AGENTAGE_STORE_OPEN_MS (optional)  AGENTAGE_CLOCK_RATE (tests only, C5)
      (or keep AGENTAGE_DATA_DIR=<configDir>/data/{id} and the kit moves the store lock to run/{id}/store.lock)
a read of secrets.json, settings.json, installation.json, daemon.json, data/<other>/, run/<other>/  ->  ERR_ACCESS_DENIED
no grant ever names a sibling of a granted folder (a same-prefix grant breaks mkdir of the folder)
below Node 22.13.0 the flags are left out (the option does not exist); below the floor /health says "seal": "off"
binds 127.0.0.1; the child runs the localOnly guard for its own port and for AGENTAGE_ORIGIN (the daemon): check 3 holds on the child port
```

## Not verified

- mcp, worker, ui and pages parts in the child (the 0.14 host does not run them there).
- macOS; a cli installed with a global symlinked prefix (`npm link`, volta, Homebrew) where the kit path is a symlink.
- A real daemon (port 4243 was in use by another session); the stand-in server answered `/host/extensions`.
- Secrets delivery through `run/{id}/secrets` with a declared secret (the spy declares none).
- Node 22.23.4 and 26.x.
