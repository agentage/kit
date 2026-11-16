#!/usr/bin/env bash
# SPIKE s113-l0: every mode, ten runs each; output in results.log.
cd "$(dirname "$0")"
for m in tsc-inc tsc-warm esbuild npm ui ui-bundle load; do timeout 600 ./run.sh $m 10 2>&1 | grep -E "RESULT|RUNS|LOAD|Error" ; done
for m in bad-syntax bad-start; do timeout 300 ./run.sh $m 2>&1 | grep -v '^{"level' ; done
