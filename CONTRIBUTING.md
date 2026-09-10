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
1. Make changes, compile, and test thoroughly. This repository uses [pnpm](https://pnpm.io) — run `pnpm install --frozen-lockfile`, then `pnpm run lint`, `pnpm run test` and `pnpm run build` before opening the pull request. `pnpm run build` runs jsii, which is what validates the published construct API, so a change that compiles under `tsc` can still fail here. See the "Developing on this repository" section of the [README](README.md) for Node.js version requirements and for how to install from the public npm registry if you are outside Alliander. Code style should match existing style and conventions, and changes should be focused on the topic the pull request will be addressed. For more information see the style guide.
1. Push commits to your fork.
1. Create a Github pull request from your topic branch.
1. Pull requests will be reviewed by one of the maintainers who may discuss, offer constructive feedback, request changes, or approve
the work. For more information see the Code review guideline.
1. Upon receiving the sign-off of one of the maintainers you may merge your changes, or if you
   do not have permission to do that, you may request a maintainer to merge it for you.


## Development setup

This repository uses [pnpm](https://pnpm.io). The version is pinned in the `packageManager` field of `package.json`, and pnpm installs that version for you on first use, so there is nothing to install beyond pnpm itself.

Use Node.js 20, 22 or 24. Do not use a newer major: jsii compiles this construct and only supports those release lines, so a newer Node produces an "untested version" warning and unsupported behaviour.

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
- **CI** sets the registry explicitly: the mirror when an `ARTIFACTORY_TOKEN` secret is available, otherwise the public registry. Pull requests from forks never have access to that secret, so they build against the public registry.

The dependency tree is identical either way. The mirror is a proxy of `registry.npmjs.org`, and `pnpm-lock.yaml` records integrity hashes rather than absolute tarball URLs, so it is not bound to a registry.

Publishing is unaffected and always targets the public registry, via `publishConfig` in `package.json`.

### Dependency cooldown

`pnpm-workspace.yaml` sets `minimumReleaseAge: 4320`, so pnpm refuses to resolve any version — direct or transitive — published less than three days ago. Most malicious package versions are caught and yanked within hours, so a cooldown filters out the smash-and-grab compromises.

This is a backstop for the public-registry path above. The Artifactory mirror already applies its own cooldown server side; a fork PR resolving straight from npmjs.org gets none, and this covers that gap.

Two consequences worth knowing:

- Adding a dependency released in the last three days fails until it matures. If you genuinely need it sooner, add that exact version to `minimumReleaseAgeExclude` rather than lowering the window for everything.
- pnpm re-validates the whole committed lockfile against this policy on every install, so widening the window can make `pnpm install --frozen-lockfile` reject a lockfile that used to be fine. Three days is deliberately narrower than Artifactory's seven for that reason.

### A note on dependency ranges

Three dependencies are deliberately *not* tracked to their newest release:

- **`aws-cdk-lib` and `constructs` (devDependencies)** pin the floor of the corresponding `peerDependencies` range. jsii requires this and warns otherwise (`JSII6 / metadata/missing-dev-dependency`). Compiling against the oldest supported version is what keeps that range honest, so raising these is a decision to drop support for older consumers, not a routine upgrade.
- **`typescript`** is held at `~6.0.x` because jsii's major.minor tracks the TypeScript compiler it is built against. `jsii@6.0` *is* the TypeScript 6.0 line, so the two move together and `typescript@7` cannot be used until `jsii@7` exists.
- **`aws-cdk`** stays on `2.x`. Version `3.0.0` on npm is an accidental publish that AWS deprecated ("This version was published accidentally. Please use 2.x.x instead.") but which still holds the `latest` dist-tag, so naive upgrade tooling will try to pull it in.

## Attribution

This Contributing.md is adapted from Google
available at
https://github.com/google/new-project/blob/master/docs/contributing.md
