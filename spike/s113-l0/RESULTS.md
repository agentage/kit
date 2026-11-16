# S1.1.3 L0 spike: reload timing and the build swap (not for merge)

Machine: Intel i5-13500T (20 threads), Linux, Node v24.6.0. Kit = this branch (0.14.0 + a spike reload route), probe 0.7.0 (`22ed442`) with `probe.patch`.
**The machine was loaded by other sessions** (load average 15 to 23 on 20 threads during most runs). The `ui` and `ui-bundle` batches ran in a quieter window. All numbers are ms, `median / worst` of 10 runs, from the file mtime to the first 200 with the new answer on `GET /api/probe/echo?msg=hi` through the daemon port.

## Timing

| Path | debounce | build | stop old | swap | fork to port (incl. store) | store open | health | first 200 | total |
|---|---|---|---|---|---|---|---|---|---|
| a1 `tsc --incremental` (batch 1) | 200 / 201 | 943 / 2578 | 38 / 112 | 1 / 19 | 1158 / 1969 | 522 / 833 | 19 / 40 | 10 / 34 | **2389 / 4498** |
| a1 `tsc --incremental` (rerun, load 15-20) | 202 / 206 | 2240 / 2690 | 96 / 177 | 3 / 4 | 2082 / 2349 | 734 / 837 | 45 / 184 | 19 / 41 | **4814 / 5327** |
| a2 `tsc --watch` kept warm (build overlaps the debounce) | 202 / 202 | 292 / 492 | 70 / 143 | 3 / 10 | 2291 / 3286 | 833 / 1801 | 47 / 72 | 17 / 185 | **3064 / 3954** |
| a3 esbuild transpile only (batch 1) | 201 / 203 | 38 / 65 | 110 / 163 | 4 / 11 | 2146 / 2267 | 838 / 873 | 39 / 203 | 19 / 33 | **2577 / 2872** |
| a3 esbuild (rerun, load 20) | 201 / 203 | 29 / 46 | 30 / 137 | 1 / 3 | 750 / 1756 | 323 / 699 | 13 / 90 | 5 / 18 | **1011 / 2165** |
| b `npm run build` (in place) | 202 / 204 | 3316 / 3651 | 98 / 121 | - | 1964 / 2244 | 741 / 899 | 52 / 131 | 21 / 33 | **5699 / 6103** |
| c `src/ui`, `npm run build` (quiet) | 200 / 202 | 1054 / 1387 | 32 / 51 | - | 641 / 953 | 272 / 413 | 14 / 19 | 7 / 9 | 2047 / 2540 |
| c `src/ui`, `agentage-widget bundle` only (quiet) | 201 / 202 | 183 / 208 | 26 / 31 | - | 549 / 696 | 237 / 342 | 11 / 13 | 5 / 10 | 971 / 1159 |

The floor without a build is debounce + restart: about 0.8 s quiet, 2.3 s loaded. Fork to port is mostly kit boot plus the PGlite open (0.25 s quiet, 0.85 s loaded). Best quiet `tsc --incremental` runs: 1.5 to 1.7 s.
The `src/ui` rows measure the bundle and a restart. The daemon child serves the api part only, so no daemon URL shows the bundle yet (S1.2.x).

## Requests during reloads (20 per second, 10 reloads, tsc path)

| sent | 200 | failed | lost | over 200 ms | p50 | longest wait |
|---|---|---|---|---|---|---|
| 624 | 624 | 0 | 0 | 203 | 9 ms | 1647 ms (gate limit 30 s) |

## Bad changes

| Case | Result |
|---|---|
| a TypeScript syntax error | `tsc` exits non-zero, no reload is sent, the old answer `v0` stays, 49/49 requests 200, max wait 45 ms. Compiler text is available (`src/api/index.ts(13,27): error TS1136: ...`). `tsc` still emits JS into `dist.next` (no `noEmitOnError`), so the staging folder is thrown away and copied again. The next good save went live (3.3 s, loaded). |
| `create` throws | New child fails (`spike: create throws`), `dist` goes back to the last good build, the old child starts again and answers `v0`. Reply: `reloaded: false, refused: "spike: create throws"`. No good answer for **3.9 s** (stop 92 ms, failed start 1.8 s, restore 1.9 s); 151/151 requests 200, none lost. A row written before (`c: 1`) is still there; the restore opened the store, so the failed child released the PGlite lock. The next good save went live (4.3 s, loaded). |

## The two-folder swap

| Candidate | Module resolution | `--allow-fs-read=<pkg>` | Source maps | Verdict |
|---|---|---|---|---|
| `dist.next/` in the package, rename swap (`dist` -> `dist.prev`, `dist.next` -> `dist`) | works (same folder depth) | works | `../../src/...` stays correct (same depth) | **pick** |
| `dist` symlink -> `.builds/N` inside the package | works (realpath stays in the package) | works | correct only when tsc builds straight into `.builds/N` (`../../../src`) | possible, more parts |
| `dist` symlink -> a folder outside the package | `ERR_MODULE_NOT_FOUND` (realpath has no `node_modules`) | denied | - | refused |

A running child whose `dist/` is replaced or deleted keeps the old code (ESM modules are in memory); `/health` stays 200. Only files read later (none in the probe api) would see the new folder.
`agentage-widget bundle` writes `dist/ui` (fixed path): it cannot build into `dist.next` without a new option.
`tsc --incremental` writes `tsconfig.build.tsbuildinfo` in the package root, not in the output folder; it stays valid only because `dist.next` is copied from the last good `dist` before each build.

## Verdict

- **D17:** holds for `src/api` with a fast build on a quiet machine (tsc 1.5 to 2.4 s median; esbuild 1.0 s). It does not hold on a loaded machine with tsc (median 4.8 s). esbuild stays under 3 s in both batches (worst 2.9 s). `src/ui` with no limit is right.
- **D13:** change it. The probe build script is `tsc -p tsconfig.build.json && agentage-widget bundle`, so D13 as written takes the `npm run build` path (5.7 s) for every probe change. Pick the build by the changed path: `src/ui` -> the bundle; else the kit runs `tsc -p tsconfig.build.json --incremental --outDir dist.next` (with `noEmitOnError`). Consider a transpile-only reload (esbuild) with a type check after it, for the 3 s target; esbuild is only a transitive dependency of the probe (via `@agentage/widget`), not a direct one.
- **D14:** change one line. The entry is fixed at `./dist/{part}/index.js`, so the swap is: stop the old child, rename `dist.next` in, start; unhealthy -> rename back, start the last good build. Risk: a daemon that dies between the rename and the health check leaves the bad build in `dist`; the boot must swap back when `dist.prev` exists without a recorded success.
- **Reload route:** `POST /host/extensions/{id}/reload`, body `{}`, folder rows only (400 for a market row). Answer `200 { id, version, state, pid, reloaded: true }`, or `200 { ..., reloaded: false, refused: "<why the new child failed>" }` while the old build runs again. The cli prints `refused`.

## Risks

- The restart floor (kit boot + PGlite open) is 0.8 to 2.3 s: on a slow machine no build path makes 3 s.
- The bad-start gap is two starts (3.9 s loaded); requests wait, none are lost.
- Not verified: the permission flags on a real daemon child (only a bare import with `--permission`); "a reload is not a crash exit" holds by construction (`halt` detaches the lane), not tested against a restart counter; a clean quiet-machine batch for tsc.
