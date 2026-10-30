# GitHub releases

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

The `Release plugin` workflow in `.github/workflows/release.yml` runs when you push
an existing commit with a `v<version>` tag. The tag must match the root `package.json`,
both root versions in `package-lock.json`, and `packages/shared/src/version.ts`; host
manifests take the version at package time. After committing your changes, run from the repository root:

```sh
npm run public-release
```

This command checks that the working tree is clean, the release versions agree,
and the current commit follows Conventional Commits. It then
creates `v<version>` at the current commit, and pushes that tag to `origin`. It
uses the current plugin version (for example, `v0.1.100`) without bumping it.
Existing tags are preserved. If the push fails after tag creation, the command
prints the exact Git command to retry the push.

### Test deployments

A prerelease version, such as `0.1.172-test.1`, runs the same workflow as a test
deployment. Set that version in the same three places on a branch, commit it as
`chore(release): prepare 0.1.172-test.1`, and push the commit and its
`v0.1.172-test.1` tag. The workflow builds, tests and packages it like a release and
publishes a GitHub prerelease with every package, including Claude's panel runtime
archive, which the Claude plugin of that build downloads. A prerelease is never
marked Latest, later release notes skip it, and it stays off `release/latest` and
`release/claude`, so Codex and Claude users do not receive it. Install its Claude
plugin from the prerelease's `claude-plugin` ZIP to test the full download. Delete
the prerelease and its tag when you are done.

You can also run the workflow from GitHub Actions with an existing version tag.
The workflow checks out that tag, uses the Apple Silicon `xcode-27` runner and
Xcode 27 / Swift 6.4, installs the locked JavaScript runtimes, and prepares the
native helpers with Android NDK 27.2.12479018 and Rust 1.98.1. It runs the tests,
builds and packages with the explicit `release` environment, then smoke-tests a
fresh extraction of the actual ZIP. CI also validates the tagged commit message,
including when the tag was pushed directly.

Each native helper has a reusable Actions artifact containing its complete vendor
directory and matching Sentry symbols. `tooling/release-native.mjs` fingerprints
the helper's tracked native sources, shared telemetry, build scripts, pinned
dependencies, npm build command, and relevant installed toolchain versions.
Plugin version bumps and UI/server edits do not change these fingerprints.
Artifacts are reused only on an exact match from a successful `Release plugin`
push or manual run in this repository. Missing or expired artifacts cause that
helper to be built; lookup, download, or integrity failures stop the release.
There is no reuse of partially matching builds.

Artifacts use tar archives to preserve executable permissions and dSYM structure.
Downloads are checked against GitHub's SHA-256 digest, then every packaged binary,
symbol and support file is verified against the archive's manifest before
installation. Existing package integrity checks, tests and extracted-ZIP smoke
tests still run. All six artifacts are saved again after validation and Sentry
upload, refreshing their 30-day retention even when restored. The native step's
Actions summary reports the duration and whether each helper was built or reused.

This uses cross-run artifacts because GitHub's dependency caches cannot be shared
between different release tags. The first release using this workflow builds all
helpers; subsequent releases reuse the matching outputs. Native build tools are
still prepared on every run so changes to installed compilers, SDKs or native
dependencies invalidate the affected artifacts.

The package uses Codex's compatibility manifest and forwards `HOME` to a launcher
that directly executes Codex's bundled Node at
`$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.
The extracted-ZIP smoke test launches that manifest with Node absent from PATH,
including both sidebar and chat entrypoints. Publishing compares the version at
the end of the previous marketplace commit title, so the manifest relocation
also works when advancing an existing portable release on `release/latest`.

Configure the repository's Actions secrets `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`.
Both are required. The workflow uploads matching UI/server source maps and native
symbols to the existing three Sentry projects before saving the artifact and
publishing a GitHub release. Upload failures stop the release. Credentials
and debug artifacts stay outside the plugin ZIP.

The published release contains a chronological bullet list of every commit title,
each linking to its GitHub commit. Commit bodies are omitted. The range starts
after the nearest published release tag reachable from the new tag; unpublished
tags and draft releases do not truncate the list. The first public release lists
the full source history. Later releases also include a link to the full diff.

Download `mobile-dev-<version>-darwin-arm64.zip` directly from the release's
assets for manual store upload. The same ZIP is also retained, with the
Claude packages, as one Actions artifact for 30 days; extract the Actions artifact
wrapper before uploading the plugin ZIP. Publishing a GitHub release does not submit or publish it to the OpenAI
plugin directory. A tag that already has a GitHub release will fail release
creation rather than replace existing assets; download the ZIP from the completed
build job or use a new version for a new release.

After the build, ZIP smoke test, Sentry upload, and GitHub release succeed, the
workflow also publishes the extracted ZIP and a marketplace catalog to `release/latest` in this
repository. The branch contains only the prebuilt marketplace; its first commit
is independent of the source history, so development ignore rules do not exclude
`dist/` or bundled runtime dependencies. Later releases advance the branch without
force pushes. Older or repeated versions leave the latest payload unchanged.
New marketplace commits use `chore(release): release mobile-dev <version>`.

Use the [installation and update commands](../CONTRIBUTING.md#install-from-the-github-marketplace).
The prebuilt marketplace is named `mobile-dev`, separate from the
`mobile-dev-local` development marketplace. A release branch does not change
repository visibility.

The configured `release/latest` ref stays attached to the marketplace. Codex
refreshes its Git snapshot and installed plugin cache; fully quit and reopen Codex
after updating so its MCP process and UI use the refreshed files. This is an explicit refresh,
not a promise of immediate automatic background updates. The first successful
release with this workflow creates the branch.

## Claude packages

The same build packages Claude with `npm run package:claude -- --release` and
checks the extracted plugin ZIP and the desktop bundle with `npm run test:claude`,
including that no file exceeds the Claude plugin directory's 5 MiB limit. The
GitHub release attaches `mobile-dev-<version>-claude-plugin-darwin-arm64.zip` and
`mobile-dev-<version>-claude-desktop-darwin-arm64.mcpb` beside the Codex ZIP; all
three are also kept as one Actions artifact for 30 days.

The `publish` job runs once per host. For Claude it publishes the plugin to
`release/claude`, laid out as the local package in `release/claude-plugin`: a Claude
Code marketplace named `mobile-dev` at the branch root
(`.claude-plugin/marketplace.json`) and the plugin in `mobile-dev/`. Like
`release/latest`, the branch starts independently of the source history, advances
without force pushes, and keeps the newest version when an older or repeated one is
published. Users install it with the commands in the
[README](../README.md#claude-code-and-claude-desktop). To submit to Anthropic's
plugin directory, point the submission at the plugin folder on that branch.

## Store updates and the GitHub migration

Release builds read the published store version through the app-server
`plugin/read` RPC, matching Mobile Dev's exact remote store ID. The experimental
API is enabled explicitly; it preserves the catalog `version` separately from
`localVersion`. The CLI listing prefers the installed version and cannot serve as
the update source once a store plugin is installed. The CLI listing is used only
to identify the legacy Git marketplace for cleanup. GitHub tags and releases do
not advertise store updates. Successful checks
are cached for one hour across chats in the active Codex profile; unavailable
checks retry after fifteen minutes. Old GitHub update caches are discarded.
Development builds do not check or migrate public installations. The Claude and
Cursor packages run the shared server, which has no updater.

The app-server plugin API is under development. This integration deliberately
accepts its compatibility risk. If discovery fails or its response no longer
matches, the check stays unavailable and retries; it never uses a GitHub version
as an alternative. The temporary app-server process closes after each lookup,
and disposal aborts pending requests.

The update banner opens the store listing through the host's link API. Store
updates are installed there. The old Git marketplace upgrade tool is removed.

For GitHub installations, migration requires a published store version of at
least **0.1.167**, and at least the running plugin version. The user installs and
enables the store version, then clicks **Finish migration**. An app-only MCP tool
checks the exact remote identity, enabled installation, installed `localVersion`,
and package manifest before removing `mobile-dev@mobile-dev` and the verified
official Git marketplace. It verifies
the store installation again afterward. Local development marketplaces and user
data are preserved. Cleanup can be retried after partial completion. A running
GitHub process retains its restart notice across chats until Codex restarts.

CLI discovery and commands use the stable Codex profile directory because
removing the GitHub plugin deletes its installation directory. `CODEX_HOME` is
forwarded by the MCP manifest. The plugin never restarts Codex automatically.

### Roll out the migration

The existing release workflow can build and publish the GitHub transition release
before store review completes:

1. Release **0.1.167** through the normal GitHub workflow. Existing GitHub versions
   can update to it through their existing updater.
2. Upload that release's ZIP to the **existing Mobile Dev store listing**, then
   complete review and publish it.
3. Once the Codex catalog exposes 0.1.167, the transition build offers migration.
   Until then, it keeps the GitHub installation working and offers no migration
   to the older store package. Catalog checks can delay the banner by up to one
   hour after publication.

One package serves both channels; a second GitHub version is not required after
store approval. The minimum migration version stays fixed for future releases.
The live 0.1.163 store package must not be used for migration: it still has the
GitHub updater. Later GitHub releases may run ahead of store review without
prematurely announcing a store update or allowing a migration downgrade.

`npm run test:updates` exercises the real Codex CLI's Git installation and removal
in a temporary profile using a local Git mirror, with a fixture for the store
catalog and package. It does not install or remove plugins in the user's account.
It requires `codex` on PATH or `CODEX_CLI_PATH`.

The repository was renamed from `codex-mobile-dev-plugin` to `mobile-dev` before
this transition release. Version 0.1.163's GitHub update check rejects the redirect
from the old release API URL. Existing GitHub users can receive the transition
build by running `codex plugin marketplace upgrade mobile-dev`, then fully quitting
and reopening Codex. Git follows the repository redirect. Migration recognizes
both official repository URLs when verifying the legacy marketplace.
