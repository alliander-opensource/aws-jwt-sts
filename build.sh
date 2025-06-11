#!/bin/bash

set -e

rm -rf dist
tsc
npx jsii --tsconfig=tsconfig.json