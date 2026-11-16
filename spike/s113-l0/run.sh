#!/usr/bin/env bash
# SPIKE s113-l0: one mode of harness.mjs against a probe working copy under the cache folder.
set -euo pipefail
C=${S113_CACHE:-$HOME/.cache/s113-l0}
export TMPDIR=$C/tmp npm_config_cache=$C/npm PROBE=$C/probe CONFIG=$C/config QUIET=1
(cd "$PROBE" && rm -rf dist dist.next dist.prev dist.bad .build && npm run build --silent >/dev/null)
node "$(dirname "$0")/harness.mjs" "$@"
