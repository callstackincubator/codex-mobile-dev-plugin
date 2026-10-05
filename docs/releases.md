# GitHub releases

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

The `Release plugin` workflow in `.github/workflows/release.yml` runs when you push
an existing commit with a `v<version>` tag. The tag must match `.codex-plugin/plugin.json`,
`package.json`, both root versions in `package-lock.json`, and
`src/shared/version.ts`. After committing your changes, run from the repository root:

```sh
npm run public-release
```

This command checks that the working tree is clean, the release versions agree,
and the current commit follows Conventional Commits. It then
creates `v<version>` at the current commit, and pushes that tag to `origin`. It
uses the current plugin version (for example, `v0.1.100`) without bumping it.
Existing tags are preserved. If the push fails after tag creation, the command
prints the exact Git command to retry the push.

You can also run the workflow from GitHub Actions with an existing version tag.
The workflow checks out that tag, uses the Apple Silicon `xcode-27` runner and
Xcode 27 / Swift 6.4, installs the locked JavaScript runtimes, and prepares the
native helpers with Android NDK 27.2.12479018 and Rust 1.98.1. It runs the tests,
builds and packages with the explicit `release` environment, then smoke-tests a
fresh extraction of the actual ZIP. CI also validates the tagged commit message,
including when the tag was pushed directly.

Each native helper has a reusable Actions artifact containing its complete vendor
directory and matching Sentry symbols. `scripts/release-native.mjs` fingerprints
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
assets for manual store upload. The same ZIP is also retained as an Actions
artifact for 30 days; extract the Actions artifact wrapper before uploading the
plugin ZIP. Publishing a GitHub release does not submit or publish it to the OpenAI
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

Use the [installation and update commands](../README.md#install).
The prebuilt marketplace is named `mobile-dev`, separate from the
`mobile-dev-local` development marketplace. A release branch does not change
repository visibility.

The configured `release/latest` ref stays attached to the marketplace. Codex
refreshes its Git snapshot and installed plugin cache; fully quit and reopen Codex
after updating so its MCP process and UI use the refreshed files. This is an explicit refresh,
not a promise of immediate automatic background updates. The first successful
release with this workflow creates the branch.

Release builds check for updates when Mobile Dev becomes visible. The server
checks GitHub's latest full release and the public `release/latest` manifest;
their versions must agree before the banner offers an update. Successful checks
are cached for one hour across chats in the active Codex profile; unavailable
checks retry after fifteen minutes. Development builds do not check or install
public updates. The embedded UI needs no GitHub network permissions.

The Update button calls an app-only MCP tool. It locates the CLI process that
launched the plugin, verifies the `mobile-dev` Git marketplace belongs to this
repository, and runs `codex plugin marketplace upgrade mobile-dev --json`.
Success requires an error-free refresh and verification of the new manifest in
Codex's installed plugin cache. The plugin preserves the restart notice across
chats until the new version runs. It does not restart Codex automatically.
`CODEX_HOME` is forwarded by the MCP manifest so updates use the same profile.

`npm run test:updates` verifies the update flow with the real Codex CLI in a
temporary profile and a local Git mirror. It checks refreshed cache files and
the restart notice without changing the user's installation or fetching a
public plugin package. It requires `codex` on PATH or `CODEX_CLI_PATH`.
