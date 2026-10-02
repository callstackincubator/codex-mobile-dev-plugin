# GitHub releases

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

The `Release plugin` workflow in `.github/workflows/release.yml` runs when you push
an existing commit with a `v<version>` tag. The tag must match `plugin.json`,
`package.json`, both root versions in `package-lock.json`, and
`src/shared/version.ts`. After committing your changes, run from the repository root:

```sh
npm run public-release
```

This command checks that the working tree is clean and the release versions agree,
creates `v<version>` at the current commit, and pushes that tag to `origin`. It
uses the current plugin version (for example, `v0.1.100`) without bumping it.
Existing tags are preserved. If the push fails after tag creation, the command
prints the exact Git command to retry the push.

You can also run the workflow from GitHub Actions with an existing version tag.
The workflow checks out that tag, uses the Apple Silicon `xcode-27` runner and
Xcode 27 / Swift 6.4, installs the locked JavaScript runtimes, and rebuilds every
native helper with Android NDK 27.2.12479018 and Rust 1.98.1. It runs the tests,
builds and packages with the explicit `release` environment, then smoke-tests a
fresh extraction of the actual ZIP.

Configure the repository's Actions secrets `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`.
Both are required. The workflow uploads matching UI/server source maps and native
symbols to the existing three Sentry projects before saving the artifact and
creating a draft GitHub release. Upload failures stop the release. Credentials
and debug artifacts stay outside the plugin ZIP.

Download `mobile-dev-<version>-darwin-arm64.zip` directly from the draft release's
assets for manual store upload. The same ZIP is also retained as an Actions
artifact for 30 days; extract the Actions artifact wrapper before uploading the
plugin ZIP. Creating a draft release does not submit or publish it to the OpenAI
plugin directory. A tag that already has a GitHub release will fail release
creation rather than replace existing assets; download the ZIP from the completed
build job or use a new version for a new release.

After the build, ZIP smoke test, and Sentry upload succeed, the workflow also
publishes the extracted ZIP and a marketplace catalog to `release/latest` in this
repository. The branch contains only the prebuilt marketplace; its first commit
is independent of the source history, so development ignore rules do not exclude
`dist/` or bundled runtime dependencies. Later releases advance the branch without
force pushes. Older or repeated versions leave the latest payload unchanged.

Use the [installation and update commands](../README.md#install).
The prebuilt marketplace is named `mobile-dev`, separate from the
`mobile-dev-local` development marketplace. A release branch does not change
repository visibility.

The configured `release/latest` ref stays attached to the marketplace. Codex
refreshes its Git snapshot and installed plugin cache; start a new session after
updating so its MCP process uses the refreshed files. This is an explicit refresh,
not a promise of immediate automatic background updates. The first successful
release with this workflow creates the branch.
