# Contributing to Mobile Dev

This guide covers building the plugin, installing it locally, and working on its UI
and native helpers. To use the prebuilt plugin, see the [README](README.md#install).

## Development requirements

- An Apple Silicon Mac with Xcode 27 and Swift 6.4 or later selected as the active
  developer tools, plus an installed iOS simulator runtime.
- Node.js 22.18 or later, npm, Git, and network access to fetch pinned dependencies.
- Rust and Cargo for the iOS native helpers. The release workflow uses Rust 1.98.1.
- CMake, Ninja, pkg-config, OpenSSL 3, Autoconf, Automake, and Libtool for native
  builds. With Homebrew, install them using:

  ```sh
  brew install cmake ninja pkgconf openssl@3 autoconf automake libtool
  ```

- An installed Android NDK for rebuilding Android collectors. The release workflow
  uses NDK 27.2.12479018. Set `ANDROID_NDK_HOME` to its installation directory.
- Bun 1.3.13 or later and Android SDK platform-tools and emulator to run Android
  features, plus an AVD or an authorized physical device.

The physical iOS log build expects OpenSSL at `/opt/homebrew/opt/openssl@3`.
Set `MOBILE_DEV_OPENSSL_PREFIX` if it is installed elsewhere.

## Build and package

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
npm run check:mcp-budget
```

Native rebuilds are required on a fresh checkout. Repeat the affected rebuild when
changing native code or shared native telemetry; the build validates source and
binary hashes. For UI or server edits with unchanged native sources, run the build,
relevant checks, and packaging steps again.

`vendor:baguette` downloads the pinned official release and checks its SHA-256. It keeps the full resource bundle and rebuilds the same v0.2.1 source with Swift 6.4 or later because the official binary crashes in Swift task allocation on macOS 27. Preparing Baguette requires Xcode 27, Git, and network access to fetch its pinned source and Swift dependencies. `rebuild:baguette` repeats the source build. `vendor/baguette/release.json` records the source commit, compiler version, and rebuilt binary SHA-256.

`vendor:agent-device` installs the exact npm packages in `runtimes/agent-device/package-lock.json` with package scripts disabled. `build` copies this full runtime into `dist/agent-device`, records its integrity and lockfile hash in `release.json`, and saves its version-matched help in the control skill. The installed plugin needs no npm install or runtime download. Xcode compiles the shipped Apple runner source on its first use.

`build` also bundles JavaScript and CSS with esbuild and copies Baguette into `dist/baguette`. It does not run TypeScript, lint, Biome, visual checks, or React Doctor.

`package` copies built files into `release/marketplace/plugins/mobile-dev` and creates the ZIP. It includes agent-device's runtime `node_modules`, licenses, and Apple runner source. It does not need this development checkout or a global agent-device install to run. The source repo's existing build-codex-native-plugins skill stays outside that release package.

`test` checks MCP contracts, frame reads, input validation, and capture cleanup against a local fixture. `test:package` copies the release package into a temporary directory, starts its bundled Baguette, reads the real device list, and checks shutdown. It does not boot or change a simulator. Run it on an Apple Silicon Mac with Xcode.

`test:agent-device` requires reactivating the Agent Device MCP entry first. It starts the retained MCP server from a copied package with no global CLI on its PATH. It checks the control tools, pinned runtime, isolated state directory, real iOS device list, and daemon cleanup. It does not open an app, take screenshots, or send input.

`npm run test:reconnect -- <UDID>` tests an already booted simulator with a copied package. It terminates only that test package's own Baguette process and checks that the same stream resumes with a new bundled process. It never boots a simulator, repairs input, or sends gestures.

The host installs a cache copy. After changing source, rebuild and package, then run `codex plugin add mobile-dev@mobile-dev-local` to update it. Reopen Mobile Dev from a new chat to load the new copy.

## Install the local build

From this project directory, after packaging:

```sh
codex plugin marketplace add ./release/marketplace
codex plugin add mobile-dev@mobile-dev-local
```

Open a new chat after installing, then open Mobile Dev from the sidebar.

`npm run package` writes the local ZIP to `release/mobile-dev-<version>-darwin-arm64.zip`. Install through the local marketplace above. The New Plugin archive dialog uploads to the workspace plugin service; it is a separate install route. This package has not gone through public directory review or publication.

## Live React UI development

Run `npm run dev` after installing the plugin. It watches the UI sources and
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

The panel uses React and shadcn/ui with preset `b0`, Nova controls, neutral colors, Inter, and Lucide icons. The build bundles the SVGs and font files into the HTML; the panel needs no external asset requests. Use the preset components in `src/ui/components/ui` for controls, forms, notices, and empty states. Compose the views with Tailwind utilities. `src/ui/style.css` only covers device frames, Codex layout, and base rules; preset tokens live in `src/ui/theme.css`. The log list uses the [Legend List React DOM entrypoint](https://www.legendapp.com/open-source/list/v3/react/getting-started/).

Panels, toolbars, settings areas, and footers use transparent backgrounds so they blend with the host. Add a panel background only when the user asks to highlight that area.

## Observability and releases

Review [Sentry observability](docs/telemetry.md) when changing instrumented paths.
Preserve measurement boundaries and privacy rules, and use the existing telemetry
helpers. Local builds use the `development` environment; public packages require
`npm run build:release` and `npm run package:release`. Keep credentials, source maps,
and native symbols outside the package.

Bump the plugin version for plugin changes and keep `plugin.json`, `package.json`,
both root versions in `package-lock.json`, and `src/shared/version.ts` in sync.
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
