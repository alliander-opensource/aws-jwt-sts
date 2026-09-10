<!--
SPDX-FileCopyrightText: 'Copyright Alliander NV'

SPDX-License-Identifier: Apache-2.0
-->

# How to Contribute

We'd love to accept your patches and contributions to this project. There are
just a few small guidelines you need to follow.

## Ways of contributing

Contribution does not necessarily mean committing code to the repository.
We recognize different levels of contributions as shown below in increasing order of dedication:

1. Test and use the project. Give feedback on the user experience or suggest new features.
2. Report bugs or security vulnerability
3. Fix bugs.
4. Improve the project with developing new features.


## Filing bugs, security vulnerability or feature requests

You can file bugs against and feature requests for the project via github issues. Consult [GitHub Help](https://docs.github.com/en/free-pro-team@latest/github/managing-your-work-on-github/creating-an-issue) for more
information on using github issues.


## Community Guidelines

This project follows the following [Code of Conduct](CODE_OF_CONDUCT.md).

## Code reviews

All patches and contributions, including patches and contributions by project members, require review by one of the maintainers of the project. We
use GitHub pull requests for this purpose. Consult
[GitHub Help](https://help.github.com/articles/about-pull-requests/) for more
information on using pull requests.

## Pull Request Process
Contributions should be submitted as Github pull requests. See [Creating a pull request](https://docs.github.com/en/github/collaborating-with-issues-and-pull-requests/creating-a-pull-request) if you're unfamiliar with this concept.

The process for a code change and pull request you should follow:

1. Create a topic branch in your local repository, following the naming format
"feature-[description]". For more information see the Git branching guideline.
1. Make changes, compile, and test thoroughly. This repository uses [pnpm](https://pnpm.io) — run `pnpm install --frozen-lockfile`, then `pnpm run lint`, `pnpm run test` and `pnpm run build` before opening the pull request. `pnpm run build` runs jsii, which is what validates the published construct API, so a change that compiles under `tsc` can still fail here. See "Development setup" below for the Node.js version requirement and "Registry" for how installs resolve inside and outside Alliander. Code style should match existing style and conventions, and changes should be focused on the topic the pull request will be addressed. For more information see the style guide.
1. Push commits to your fork.
1. Create a Github pull request from your topic branch.
1. Pull requests will be reviewed by one of the maintainers who may discuss, offer constructive feedback, request changes, or approve
the work. For more information see the Code review guideline.
1. Upon receiving the sign-off of one of the maintainers you may merge your changes, or if you
   do not have permission to do that, you may request a maintainer to merge it for you.


## Development setup

This repository uses [pnpm](https://pnpm.io). The version is pinned in the `packageManager` field of `package.json`, and pnpm installs that version for you on first use, so there is nothing to install beyond pnpm itself.

Use Node.js 22 or 24; CI pins 24. jsii is the constraint here, not the runtime: it compiles this construct and supports `^20`, `^22` and `^24` only, so a newer major produces an "untested version" warning and unsupported behaviour.

Node 20 is technically still accepted but should not be used. It reached end-of-life on 2026-04-30, so jsii already marks it `[DEPRECATED]` and warns on every build, and it leaves jsii's extended support window on 2026-10-30, after which the warning becomes a hard "not supported anymore".

```sh
pnpm install --frozen-lockfile   # install exactly what pnpm-lock.yaml pins
pnpm run lint                    # oxlint
pnpm run test                    # jest, with coverage
pnpm run build                   # tsc, then jsii (validates the published API surface)
```

### Registry

This repository does not pin an npm registry. Each environment supplies its own, so nothing here needs editing and no flags are required:

- **External contributors** get their default, `registry.npmjs.org`. Just run `pnpm install`.
- **Alliander developers** get the Artifactory npm mirror from their user-level config. The public registry is not fully reachable from inside the Alliander network, so configure the mirror once, per machine:

  ```sh
  pnpm config set --location=user registry \
    https://alliander.jfrog.io/artifactory/api/npm/alliander-npm-all/
  pnpm config set --location=user \
    //alliander.jfrog.io/artifactory/api/npm/alliander-npm-all/:_authToken <token>
  ```

  Keep both the registry and the token in that user-level file. This repository intentionally commits no `.npmrc` at all; if you add one, never put credentials in it, and note that since pnpm 10 only registry and auth settings are read from `.npmrc` — every other pnpm setting belongs in `pnpm-workspace.yaml`.
- **CI** uses the public registry, and deliberately does not authenticate against the mirror. This is a public repository, so a fork's pull request can never be given a secret; routing CI through the mirror would mean the only path that works for external contributors is the untested one. Keeping both workflows on a single unauthenticated path means CI validates what contributors actually build. It also keeps a long-lived registry credential off a public repository, where every step of a fork-triggered job would inherit it.

The dependency tree is identical either way. The mirror is a proxy of `registry.npmjs.org`, and `pnpm-lock.yaml` records integrity hashes rather than absolute tarball URLs, so it is not bound to a registry.

If the mirror is ever wired into CI as well, three constraints apply, and they are the reason it is not wired in today:

- The credential must be short-lived, obtained per run over OIDC, in the way `Alliander/get-artifactory-credentials` does it. A long-lived static secret on a public repository is not an acceptable substitute. Note that this repository cannot consume the shared `cp-gh-shared-actions` directly, because GitHub does not let a public repository use actions from private or internal repositories.
- Scope it with a step-level `env:` on the install step. Do not export it through `$GITHUB_ENV`, which places it in the environment of every later step, including dependency build scripts permitted by `allowBuilds`.
- Keep the public-registry path working unchanged, and keep it the path fork pull requests take. Forks can never receive a secret, so if the mirror becomes the only tested path, external contributions break.

Publishing is unaffected and always targets the public registry, via `publishConfig` in `package.json`.

### Dependency cooldown

`pnpm-workspace.yaml` sets `minimumReleaseAge: 4320`, so pnpm refuses to resolve any version — direct or transitive — published less than three days ago. Most malicious package versions are caught and yanked within hours, so a cooldown filters out the smash-and-grab compromises.

This is the primary supply-chain control on the public-registry path, which is every CI install and every install by an external contributor. Alliander developers additionally get the Artifactory mirror's own (~7 day) server-side cooldown on top; nobody gets less than three days.

Three consequences worth knowing:

- Adding a dependency released in the last three days fails until it matures. If you genuinely need it sooner, add that exact version to `minimumReleaseAgeExclude` rather than lowering the window for everything.
- pnpm re-validates the whole committed lockfile against this policy on every install, so widening the window can make `pnpm install --frozen-lockfile` reject a lockfile that used to be fine.
- Because `minimumReleaseAge` is set explicitly, pnpm auto-enables `minimumReleaseAgeStrict`. Outside a TTY — which is to say, in CI — an immature version is a hard `ERR_PNPM_NO_MATURE_MATCHING_VERSION` failure rather than a silent exclusion. Dependabot's `cooldown` in `.github/dependabot.yml` is set to four days for that reason — one day of margin over this window — so bot pull requests do not open inside it. Dependabot's own resolution does not honour `minimumReleaseAge`, so it can still pull in a *transitive* version younger than three days; when that happens, rerun the job once the window has passed, or add the exact version to `minimumReleaseAgeExclude`. Do not lower the window.

### A note on dependency ranges

Several dependencies are deliberately *not* tracked to their newest release:

- **`@types/node`** stays on `^24`. These typings are the upper bound on what the handlers in `src/index.sign.ts` and `src/index.keyrotate.ts` can reference and still compile, so the bound must not run ahead of the runtime they deploy to — `Runtime.NODEJS_24_X` in `src/index.ts`. CI pins Node 24 as well, so typings, build and runtime are one version. Concretely, `@types/node@26` declares `node:quic`, `node:ffi` and `node:vfs`, none of which exist on a Node 24 Lambda. Do not raise this to `^26` or later without moving the Lambda runtime first; the two move together.
- **`aws-cdk-lib` and `constructs` (devDependencies)** pin the floor of the corresponding `peerDependencies` range. Compiling against the oldest supported version is what keeps that range honest, so raising these is a decision to drop support for older consumers, not a routine upgrade — move the devDependency and the peer range together. `scripts/check-peer-floors.mjs` enforces it as part of `pnpm run build`; see below.
- **`typescript`** is held at `~6.0.x` because jsii's major.minor tracks the TypeScript compiler it is built against. `jsii@6.0` *is* the TypeScript 6.0 line, so the two move together and `typescript@7` cannot be used until `jsii@7` exists.
- **`aws-cdk`** stays on `2.x`. Version `3.0.0` on npm is an accidental publish that AWS deprecated ("This version was published accidentally. Please use 2.x.x instead.") but which still holds the `latest` dist-tag, so naive upgrade tooling will try to pull it in.

#### Why the peer floor is checked in CI

jsii enforces the floor rule itself, comparing `devDependencies[name]` against `semver.minVersion(peerRange).raw` in `lib/project-info.js`. But it reports a violation as `JSII6 / metadata/missing-dev-dependency`, which is a *warning* that exits 0, and its severity cannot be raised because it is emitted before diagnostic overrides load — `jsii --fail-on-warnings` does not catch it either. So on its own the rule is unenforceable in CI, and a dependency bump that breaks it would merge green.

`scripts/check-peer-floors.mjs` reimplements the same comparison and exits non-zero. `build.sh` runs it ahead of `tsc`, so it gates both workflows and any local `pnpm run build`. It fails on *inconsistency*, not on upgrades: raising the devDependency and the peer range together passes.

That check is what lets `.github/dependabot.yml` leave `aws-cdk-lib` and `constructs` out of its `ignore` list. Every remaining entry there is scoped to specific versions or update types, which matters because a bare `dependency-name` ignore expands to `>= 0` and applies to security updates as well as version updates. `aws-cdk` ignores only the bad `3.0.0` publish; `typescript` and `@types/node` ignore majors only; `jsii` is not ignored at all, since a jsii release is the signal that a paired TypeScript bump is available, and both land in the same grouped pull request. If you change a pin here, check whether that file needs the same change.

## Attribution

This Contributing.md is adapted from Google
available at
https://github.com/google/new-project/blob/master/docs/contributing.md
