# Contributing to Mobile Dev

This guide covers building the plugin, installing it locally, and working on its UI
and native helpers. To use the prebuilt plugin, see the [README](README.md#install).

## Repository layout

The repository is an npm workspace. Host-independent code lives in `packages/`; each
product that ships it lives in `apps/`. Adding a host means adding an app; the shared
packages know no host by name. Hosts that load a plugin folder with the shared server
(Claude, Cursor) need only an app with a manifest, an icon and a `plugin-host.json`
describing it: [`tooling/plugin-hosts.mjs`](tooling/plugin-hosts.mjs) finds those apps,
and `tooling/package-plugin.mjs`, `smoke-plugin.mjs` and `plugin-config.mjs` take the
host as an argument.

| Path | Contents |
| --- | --- |
| `packages/shared` (`@mobile-dev/shared`) | Protocol types and pure logic used by the server and every UI host. |
| `packages/core` (`@mobile-dev/core`) | The MCP server, device runtimes and tool handlers. A host adds to it with `ServerFeature`s passed to `runStdioServer`. |
| `packages/ui` (`@mobile-dev/ui`) | Host-independent React views, panel controllers, theme and UI telemetry. Views reach the host only through `HostBridge`. |
| `packages/mcp-app` (`@mobile-dev/mcp-app`) | The MCP Apps panel every MCP Apps host loads. Host differences follow advertised capabilities; a host adds chrome through `startMcpApp`. |
| `packages/native` | Native helper sources; `packages/native/vendor` holds their verified prebuilt binaries. |
| `packages/runtimes` | Pinned Node runtimes bundled into the server (agent-device, serve-emu). |
| `packages/skills` | Agent skills for the shared tools; each host's package step includes the ones its host supports. |
| `apps/codex-plugin` | Codex: manifest, launcher, assets, and its own server (`server/`, the self-updater) and panel (`ui/`, the update banner). |
| `apps/claude` | Claude: the Claude Desktop extension (`manifest.json`, MCPB) and the Claude Code plugin (`.claude-plugin/plugin.json`). Both run the shared server and panel unchanged. |
| `apps/cursor` | Cursor: the Cursor plugin manifest (`.cursor-plugin/plugin.json`). It runs the shared server and panel unchanged. |
| `apps/mac` | The Mac app: a SwiftUI shell (`Sources/`), the page it hosts (`web/`) and its server (`server/`). |
| `packages/test-support` | Fixtures shared by tests across packages and apps. |
| `tooling` | Shared build, native, release and device smoke-test scripts. Run them from the repository root. |

Each app's `tooling/` holds that host's packaging and smoke tests.

Tests live beside the code they cover, in each package's or app's `test/` folder;
`tooling/test` covers the release and build scripts. Fixtures several packages share
are in `packages/test-support`. `npm test` runs them all from the repository root,
which test paths such as `packages/ui/src/...` are relative to.

Import across packages with the workspace name and an explicit extension, for example
`@mobile-dev/shared/logs.ts`. `packages/ui` never imports from `packages/mcp-app` or an
app. Chrome every MCP Apps host shares belongs in `packages/mcp-app`; chrome for one
host, such as the Mac sidebar or Codex's update banner, belongs in that host's app.

`npm run build` writes the host-neutral runtime to `dist/`: the shared server, its
services and natives, and the MCP Apps panel. Each host's package step copies that
runtime and builds the host's own pieces into the copy: Codex its server and panel,
the Mac app its server and page. No host packages through another, and the shared
build knows no host. The release version comes
from the root `package.json`; each package step writes it into its host's manifest.
The published `release/latest` layout is unchanged.

## Mac app

The Mac app runs the same server and shared UI as the Codex plugin. A SwiftUI
window provides the native sidebar (tools and visible device platforms); a web
view renders `apps/mac/web`, the shared views without the Codex toolbar.

The app starts the bundled server over stdio exactly as Codex does and relays
JSON-RPC lines between it and the page. Before the page connects, the app reads
`ui://mobile-dev/mac.html` from the server, so the page gets the server's telemetry
metadata. The page implements `HostBridge` (`packages/ui/src/host-bridge.ts`) with
an MCP client and offers no chat capabilities, so chat-only actions stay hidden.

```sh
npm run build        # shared runtime in dist/
npm run build:mac    # release/mac/Mobile Dev.app, signed ad hoc
npm run test:mac     # launches the app, waits for the page to connect and draw, quits
open "release/mac/Mobile Dev.app"
```

`build:mac` copies the runtime from `dist/`, builds the Mac server and page into it, and
adds the Node executable running the build
(pass `--node <path>` for another self-contained build) into the app. Distribution
still needs a Developer ID signature, hardened-runtime entitlements for Node, and
notarization. `test:mac` uses the app's `MOBILE_DEV_SMOKE_SNAPSHOT` hook to save a
page snapshot because it cannot rely on Screen Recording permission; pass a path to
keep it. Restart the server from **View › Restart Server** (⇧⌘R).

## Development requirements

- An Apple Silicon Mac with Xcode 27 and Swift 6.4 or later selected as the active
  developer tools, plus an installed iOS simulator runtime.
- Node.js 22.19 or later, npm, Git, and network access to fetch pinned dependencies.
- Rust and Cargo for the iOS native helpers. The release workflow uses Rust 1.98.1.
- CMake, Ninja, pkg-config, OpenSSL 3, Autoconf, Automake, and Libtool for native
  builds. With Homebrew, install them using:

  ```sh
  brew install cmake ninja pkgconf openssl@3 autoconf automake libtool
  ```

- An installed Android NDK for rebuilding Android collectors. The release workflow
  uses NDK 27.2.12479018. Set `ANDROID_NDK_HOME` to its installation directory.
- Android SDK platform-tools and emulator to run Android
  features, plus an AVD or an authorized physical device.

The physical iOS log build expects OpenSSL at `/opt/homebrew/opt/openssl@3`.
Set `MOBILE_DEV_OPENSSL_PREFIX` if it is installed elsewhere.

## Build and package

New commits and pull request titles must use
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), for example
`feat(devices): add simulator controls` or `fix(logs): handle disconnects`.
Supported types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
`refactor`, `revert`, `style`, and `test`; scopes are optional, and `!` marks a
breaking change. `npm ci` installs a Husky `commit-msg` hook that runs commitlint.
CI checks commits added by pull requests and pushes to `main`, plus pull request
titles for squash merges. Git-generated merge messages are exempt. Existing
history does not need rewriting. Make the `commitlint` check required in the
repository's branch rules to block merging a failed check.

From the repository root, prepare the JavaScript runtimes and native helpers,
then build and verify the package:

```sh
npm ci
npm run vendor:baguette
npm run vendor:agent-device
npm run vendor:serve-emu
npm run rebuild:ios-fps
npm run rebuild:ios-mirror
npm run rebuild:ios-logs
npm run rebuild:android-fps
npm run rebuild:android-cpu
npm run build
npm test
npm run package
npm run test:package
npm run test:codex-plugin
npm run check:mcp-budget
```

Native rebuilds are required on a fresh checkout. Repeat the affected rebuild when
changing native code or shared native telemetry; the build validates source and
binary hashes. For UI or server edits with unchanged native sources, run the build,
relevant checks, and packaging steps again.

`vendor:baguette` downloads the pinned official release and checks its SHA-256. It keeps the full resource bundle and rebuilds the same v0.2.1 source with Swift 6.4 or later because the official binary crashes in Swift task allocation on macOS 27. Preparing Baguette requires Xcode 27, Git, and network access to fetch its pinned source and Swift dependencies. `rebuild:baguette` repeats the source build. `packages/native/vendor/baguette/release.json` records the source commit, compiler version, and rebuilt binary SHA-256.

`vendor:agent-device` installs the exact npm packages in `packages/runtimes/agent-device/package-lock.json` with package scripts disabled. `build` copies this full runtime into `dist/agent-device`, records its integrity and lockfile hash in `release.json`, and saves its version-matched help in the control skill. The installed plugin needs no npm install or runtime download. Xcode compiles the shipped Apple runner source on its first use.

`build` also bundles JavaScript and CSS with esbuild and copies Baguette into `dist/baguette`. It does not run TypeScript, lint, Biome, visual checks, or React Doctor.

`package` copies built files into `release/marketplace/plugins/mobile-dev` and creates the ZIP. It includes agent-device's runtime `node_modules`, licenses, and Apple runner source. The Codex compatibility manifest lives at `apps/codex-plugin/.codex-plugin/plugin.json` and declares `.mcp.json`. The MCP entry invokes `apps/codex-plugin/scripts/launch-mcp.sh` (`scripts/launch-mcp.sh` inside the package) through `/bin/sh` and explicitly forwards `HOME` and the telemetry settings. The launcher directly executes Codex's bundled Node at `$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`. `npm start` uses the same launcher. The `build-codex-native-plugins` skill in `.agents/skills` helps agents working on this repository and is not shipped.

`test` checks MCP contracts, frame reads, input validation, and capture cleanup against a local fixture, plus runtime selection and argument forwarding with Node absent from PATH or another Node present. `test:package` copies the release package into a temporary directory and uses its actual MCP launch configuration with a system-only PATH. The smoke-test caller supplies an isolated home with the Codex runtime cache layout and its test Node executable; the MCP process has a system-only PATH. Run these checks with the Codex bundled Node executable to verify the packaged runtime. It checks native addon loading, sidebar/chat entrypoints, UI resources, and telemetry attribution, starts bundled Baguette, reads the real device list, and checks shutdown. It does not boot or change a simulator. Run it on an Apple Silicon Mac with Xcode.

`test:codex-plugin` requires the Codex CLI (`codex` on PATH or `CODEX_CLI_PATH`). It installs the package into a temporary Codex profile, asks Codex to resolve the installed MCP configuration, then starts that exact command and working directory with no Node on MCP PATH. It checks the sidebar resource and telemetry opt-out without changing the user's plugins or devices. Pass an extracted ZIP directory to test the shipped artifact. The compatibility manifest uses `cwd: "."`; `${PLUGIN_ROOT}` is not expanded in this format and would become a nonexistent subdirectory of the installed cache.

`test:agent-device` requires reactivating the Agent Device MCP entry first. It starts the retained MCP server from a copied package with no global CLI on its PATH. It checks the control tools, pinned runtime, isolated state directory, real iOS device list, and daemon cleanup. It does not open an app, take screenshots, or send input.

`npm run test:reconnect -- <UDID>` tests an already booted simulator with a copied package. It terminates only that test package's own Baguette process and checks that the same stream resumes with a new bundled process. It never boots a simulator, repairs input, or sends gestures.

The host installs a cache copy. After changing source, rebuild and package, then run `codex plugin add mobile-dev@mobile-dev-local` to update it. Reopen Mobile Dev from a new chat to load the new copy.

`npm run test:ios-mirror-sharing -- <hardware UDID>` opens independent MCP processes for the same iPhone, pauses one reader, closes one panel, and joins another. It verifies frame fan-out and recovery without sending input. It excludes the iframe bridge and browser rendering. Close Device Hub’s mirror before running it.

## Host regression and visual tests

Pull requests run [CI](.github/workflows/ci.yml) on Linux: the unit tests (macOS-only paths
skip themselves), a Codex regression job and a Codex visual regression job. The
`claude` and `mac` regression projects run locally until those targets ship. The host jobs need no Mac, simulator or host app. `build:hosts` builds
each target's real server and page without the native helpers, and Playwright drives
them in [`tooling/hosts`](tooling/hosts):

- Codex and Claude load their panel in a stand-in MCP Apps host. It advertises
  each host's capabilities and style tokens from [`profiles.ts`](tooling/hosts/profiles.ts)
  and answers the panel through the real server over stdio. Update a profile when a
  host changes what it advertises.
- The Mac app's page loads the way its `PageLoader` does, with a stand-in for the
  WebKit relay.

```sh
npm run build:hosts            # or: npm run build:hosts -- codex
npm run test:hosts             # regression checks, any OS
npm run test:visual:docker     # screenshots in the CI image (needs Docker)
npm run test:visual:docker -- --update-snapshots
```

Visual baselines live in `tooling/hosts/screenshots` and are rendered in the pinned
Playwright Linux image, so take and update them through `test:visual:docker` rather
than on macOS. After an intended UI change, update them and review the image diff
in the pull request. When screenshots change, CI comments on the pull request with
main's image, the pull request's and their diff, and a link to compare them with
GitHub's swipe and onion skin views (the images live on the `visual-diffs` branch).
It also uploads the Playwright report, which has a before/after slider: open it
with `gh run download <run> -n visual-regression` and `npx playwright show-report
visual-regression/playwright-report`. Keep the image tag in `ci.yml` in step with
`@playwright/test`.

## Weekly dependency updates

[`dependency-updates.yml`](.github/workflows/dependency-updates.yml) runs every Monday
(or from the Actions tab) on the release build's Mac runner and keeps one pull
request, `deps/weekly`, current:

1. [`update-dependencies.mjs`](tooling/update-dependencies.mjs) applies every
   compatible update: npm packages in all workspaces and both device runtimes,
   pinned GitHub Actions, Baguette, sentry-native, the iOS log reader's
   libimobiledevice sources and the iPhone mirror's Rust crates. Compatible means the
   same major version, or the same minor for 0.x. Breaking versions, the serve-emu
   fork, scrcpy, Perfetto and unreleased Git pins are listed in the pull request for a
   person to update.
2. `release-native.mjs` rebuilds the native helpers whose pins changed.
3. [`dependency-checks.mjs`](tooling/dependency-checks.mjs) runs the unit tests,
   build, package, the packaged server, a simulator stream with a Baguette restart
   and the Codex regression tests.
4. If a check fails and the `ANTHROPIC_API_KEY` secret is set, Claude Code fixes the
   code or Baguette's patches (or reverts one update it cannot make work), and the
   checks run again. Its changes are a separate `fix(deps)` commit with notes in the
   pull request.
5. The pull request lists what changed and the check results, and CI adds the Linux
   unit tests, Codex regression tests and the visual comparison with main.

Run `node tooling/update-dependencies.mjs` to see available updates without changing
anything. Without a `DEPENDENCY_UPDATES_TOKEN` secret (a token with `contents`,
`pull-requests` and `workflows` write access), action pins are only reported, because
the workflow token cannot edit workflow files. Physical-iPhone features need a
device: try mirroring and logs on one before merging when their pins changed.

## Native iOS test app

The repo includes a small [SwiftUI test app](examples/ios-test-app/README.md) for
repeatable checks of simulator input, accessibility, navigation, scrolling, native
logs, and CPU/memory monitoring. Open its Xcode project or use its build-and-run
script with a booted simulator UDID. It needs no external app dependencies and is
not included in the plugin package.

## Install from the GitHub marketplace

Most users should install Mobile Dev from the
[Codex plugin directory](README.md#install). To install the prebuilt plugin from
this repository's release marketplace instead:

```sh
codex plugin marketplace add https://github.com/callstackincubator/mobile-dev.git --ref release/latest
codex plugin add mobile-dev@mobile-dev
```

Open a new chat after installing. The package includes the built plugin and
bundled runtimes; no plugin build or `npm install` is needed.

Mobile Dev shows a banner when a newer release is ready to install. Click
**Update**, then fully quit and reopen Codex after it finishes.

You can also update an existing installation from the terminal:

```sh
codex plugin marketplace upgrade mobile-dev
```

Fully quit and reopen Codex after updating.

## Install the local build

### Codex

From this project directory, after packaging:

```sh
codex plugin marketplace add ./release/marketplace
codex plugin add mobile-dev@mobile-dev-local
```

Open a new chat after installing, then open Mobile Dev from the sidebar.

`npm run package` writes the local ZIP to `release/mobile-dev-<version>-darwin-arm64.zip`. Install through the local marketplace above. The New Plugin archive dialog uploads to the workspace plugin service; it is a separate install route. This package has not gone through public directory review or publication.

### Claude Desktop local development

Complete the first-time runtime and native-helper setup under [Build and package](#build-and-package),
then run from this checkout with Node.js 22.19 or later:

```sh
npm run build
npm run claude:config
```

1. Open Claude Desktop **Settings > Developer > Edit Config**. On macOS, this is
   `~/Library/Application Support/Claude/claude_desktop_config.json`.
2. Merge the `mobile-dev` entry from `.local-dev/claude-desktop-config.json` into
   the existing `mcpServers` object, preserving other servers and settings. The
   snippet uses absolute paths to this checkout and the Node executable running
   the generator.
3. Fully quit and reopen Claude, start a new conversation, and ask **“Open Mobile Dev.”**
   Approve the connector when prompted; use **Expand** when available.

After UI or server edits, run `npm run build` and fully restart Claude. This
workflow uses the checkout directly and needs no repackaging. Regenerate the
config if the checkout or Node path changes. For connection failures, check
**Settings > Developer** for the server status and logs.

To create and check a bundle for manual installation instead:

```sh
npm run package:claude
npm run test:claude
```

This writes `release/mobile-dev-<version>-claude-desktop-darwin-arm64.mcpb` and
the Claude plugin folder `release/claude-plugin/mobile-dev`. The plugin folder
uses `apps/claude/.claude-plugin/plugin.json`, which starts `dist/server.mjs` with Node.js
22.19 or later from `PATH`, and leaves out the Codex manifest, `.mcp.json`, and
launcher. Check it with `claude plugin validate ./release/claude-plugin/mobile-dev`,
or load it with `claude --plugin-dir ./release/claude-plugin/mobile-dev`.
Follow the [manual installation steps](README.md#claude-desktop-manual-installation).
Remove the `mobile-dev` development entry before installing the bundle to avoid
duplicate servers. Rebuild, repackage, and reinstall to update a bundled copy.

Local builds retain the `development` telemetry environment. Public releases use
`npm run build:release` and `npm run package:claude -- --release`.

### Cursor local development

Complete the first-time runtime and native-helper setup under [Build and package](#build-and-package),
then run from this checkout with Node.js 22.19 or later:

```sh
npm run build
npm run cursor:config
```

1. Merge the `mobile-dev` entry from `.local-dev/cursor-mcp.json` into the
   `mcpServers` object in `~/.cursor/mcp.json`, preserving other servers. Use the
   global file rather than a project's `.cursor/mcp.json`: the snippet uses absolute
   paths to this checkout and the Node executable running the generator.
2. Reload Cursor, check that `mobile-dev` is enabled in the MCP section of Cursor Settings, and
   ask **“Open Mobile Dev”** in a new agent chat.

After UI or server edits, run `npm run build` and reload Cursor. Regenerate the
config if the checkout or Node path changes.

To create and check a plugin folder for manual installation instead:

```sh
npm run package:cursor
npm run test:cursor
```

This writes the Cursor plugin folder `release/cursor-plugin/mobile-dev` from the shared
runtime. It uses `apps/cursor/.cursor-plugin/plugin.json`, which starts
`${CURSOR_PLUGIN_ROOT}/dist/server.mjs` with Node.js from `PATH`, and leaves out the
Codex manifest, `.mcp.json`, launcher and updater.
Follow the [manual installation steps](README.md#cursor-manual-installation).
Remove the `mobile-dev` development entry before installing the plugin to avoid
duplicate servers. Public releases use `npm run build:release` and
`npm run package:cursor -- --release`.

## Live React UI development

In Codex, run `npm run dev` after installing the plugin. It watches the UI sources and
rebuilds a self-contained HTML bundle. Open panels read updates through MCP,
then reload and reconnect their streams. Edits reset UI state.

Codex denies browser access to localhost, including trusted HTTPS. Live reload
uses the existing MCP connection and needs no dev server or certificates.
`npm run dev` reuses a watcher already running from this repo.

Restart Codex after installing a new plugin version, then reopen Mobile Dev.
UI and CSS edits reload without another restart. MCP server changes still need
a rebuild and a server restart.

Run `npm run dev:off` and reopen the panel to use the release bundle. A stopped
watcher also makes newly opened panels use that bundle. Build errors keep the
last working UI. Set `MOBILE_DEV_PLUGIN_ROOT` for a nonstandard plugin install.

## UI conventions

The panel uses React and shadcn/ui with preset `b0`, Nova controls, neutral colors, Inter, and Lucide icons. The build bundles the SVGs and font files into the HTML; the panel needs no external asset requests. Use the preset components in `packages/ui/src/components/ui` for controls, forms, notices, and empty states. Compose the views with Tailwind utilities. `packages/ui/src/style.css` only covers device frames, Codex layout, and base rules; preset tokens live in `packages/ui/src/theme.css`. The log list uses the [Legend List React DOM entrypoint](https://www.legendapp.com/open-source/list/v3/react/getting-started/).

Panels, toolbars, settings areas, and footers use transparent backgrounds so they blend with the host. Add a panel background only when the user asks to highlight that area.

## Observability and releases

Review [Sentry observability](docs/telemetry.md) when changing instrumented paths.
Preserve measurement boundaries and privacy rules, and use the existing telemetry
helpers. Local builds use the `development` environment; public packages require
`npm run build:release` and `npm run package:release`. Keep credentials, source maps,
and native symbols outside the package.

Bump the version in the root `package.json` for product changes and keep both root
versions in `package-lock.json` and `packages/shared/src/version.ts` in sync. Host
manifests carry no version; each package step writes it.
See [GitHub releases](docs/releases.md) for tagging, CI packaging, symbol uploads,
and marketplace publishing.

## Reference documentation

- [Architecture](docs/architecture.md): backend ownership, streaming, app discovery,
  annotations, and native device requests.
- [Using devices](docs/devices.md), [app logs](docs/logs.md), and
  [performance](docs/performance.md): detailed behavior and platform limitations.
- [MCP tools](docs/mcp-tools.md): tool catalog and retained Agent Device integration.
- [Agent workflow cases](docs/agent-workflow.md): manual checks in fresh chats.
- [Stream profiling](docs/stream-profiling.md): performance findings and historical measurements.
