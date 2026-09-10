#!/usr/bin/env node

// Fails when a peerDependency does not have a devDependency pinned to the exact
// floor of its range.
//
// jsii enforces the same rule -- lib/project-info.js compares
// `devDependencies[name] !== semver.minVersion(peerRange).raw` -- but only
// reports JSII6 (metadata/missing-dev-dependency), which is a warning that
// exits 0. Its severity cannot be raised, because it is emitted before
// diagnostic overrides load, so not even `jsii --fail-on-warnings` turns it into
// a failure. Without this check a dependency bump merges green while quietly
// breaking the guarantee that the declared peer range is actually compiled
// against.

import { readFileSync } from 'node:fs';

const pkgUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));

const peers = pkg.peerDependencies ?? {};
const devs = pkg.devDependencies ?? {};

// Floor of the range shapes this repository uses. Anything else is reported
// rather than guessed at, so an unrecognised range cannot pass silently.
const SIMPLE_RANGE = /^[~^]?(\d+\.\d+\.\d+(?:-[\dA-Za-z.-]+)?)$/;

const problems = [];

for (const [name, range] of Object.entries(peers)) {
  const match = SIMPLE_RANGE.exec(range);

  if (match === null) {
    problems.push(
      `${name}: peer range "${range}" is not a plain caret, tilde or exact ` +
        'range, so this check cannot determine its floor. Widen the check ' +
        'rather than removing the pin.',
    );
    continue;
  }

  const floor = match[1];
  const dev = devs[name];

  if (dev === undefined) {
    problems.push(
      `${name}: declared in peerDependencies as "${range}" but absent from ` +
        `devDependencies. Add "${name}": "${floor}".`,
    );
  } else if (dev !== floor) {
    problems.push(
      `${name}: devDependency is "${dev}" but must be exactly "${floor}", ` +
        `the floor of peer range "${range}".`,
    );
  }
}

if (problems.length > 0) {
  console.error('peerDependencies/devDependencies floor mismatch in package.json:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '\nCompiling against the oldest supported version is what keeps a peer ' +
      'range honest.\nRaising a floor drops support for older consumers, so ' +
      'move the devDependency and the\npeerDependencies range together, ' +
      'deliberately.',
  );
  process.exit(1);
}

console.log(`peer floors OK (${Object.keys(peers).length} peerDependencies checked)`);
