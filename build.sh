#!/usr/bin/env bash

set -euo pipefail

rm -rf dist

# Runs before the compilers because it guards an invariant jsii checks but only
# WARNS about, at exit 0 -- see the script header.
node scripts/check-peer-floors.mjs

# `pnpm run build` puts node_modules/.bin on PATH, so tsc and jsii resolve to
# the versions pinned in pnpm-lock.yaml.
tsc
jsii --tsconfig=tsconfig.json
