#!/usr/bin/env bash
# Five runs each: node x package x sealed x first/warm; one JSON line per run.
set -u
cd "$(dirname "$0")"
export DATA_SUB=store TMPDIR=${TMPDIR:-$HOME/.cache/s112-b0/tmp}
for v in "$@"; do
  N=~/.nvm/versions/node/v$v/bin/node
  for k in spy probe7 probe6; do
    for s in 0 1; do
      for f in 1 0; do
        for i in 1 2 3 4 5; do
          echo "{\"node\":\"$v\",\"run\":$i,\"r\":$(timeout 90 $N harness.mjs $N $k $s $f | head -c 400)}"
        done
      done
    done
  done
done
