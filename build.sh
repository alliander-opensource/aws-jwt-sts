#!/usr/bin/env bash

set -euo pipefail

rm -rf dist

# `pnpm run build` puts node_modules/.bin on PATH, so tsc and jsii resolve to
# the versions pinned in pnpm-lock.yaml.
#
# Do not reintroduce `npx` here. npx falls back to fetching a package from the
# registry when it cannot resolve one locally, which would silently compile the
# construct with a different jsii/TypeScript than the one we locked. jsii's
# major.minor tracks TypeScript's, so a drifting jsii is a drifting compiler.
tsc
jsii --tsconfig=tsconfig.json
