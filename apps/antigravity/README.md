# Mobile Dev for Antigravity

Build, run, and debug iOS and Android apps without leaving Antigravity. Mobile Dev
streams your simulators, emulators, and devices into an Antigravity Auxiliary Pane
(`sidecar://mobile-dev/device-panel/`) beside the chat, and gives Antigravity the tools
to control them, read their logs, inspect your app, and measure its performance. It
works with Expo, React Native, SwiftUI, and other native mobile projects.

- **Auxiliary Pane device panel:** a live, interactive iOS simulator, Android
  emulator, or connected device in the Antigravity side pane, with logs, storage, App
  Intelligence, and performance tools beside it. Antigravity reads the devices you
  select there and the logs, screenshots, and notes you add to chat.
- **Device control and inspection:** Antigravity taps, types, scrolls, reads the
  accessibility tree, and takes screenshots through the bundled
  [agent-device](https://agent-device.dev/) runtime.
- **App control:** install, launch, and stop apps, open deep links, send test pushes,
  and set permissions and languages.
- **App Flow:** a visual map of your app's screens and the navigation between them,
  read from your Expo Router or React Navigation source and optionally captured by
  walking the app on an iOS simulator.
- **App Intelligence:** static screen-to-dependency graphs for Expo Router and React
  Navigation projects, tracing each screen through its source files, assets, and
  packages without building or running the app.
- **Logs:** iOS unified logs, Android logcat, physical iPhone logs, and Metro console
  messages.
- **Performance:** CPU, memory, and FPS recordings shown as interactive charts, which
  Antigravity can analyze and compare.
- **App storage:** read what your app saved, such as UserDefaults, SharedPreferences,
  AsyncStorage, MMKV, and SQLite, without adding code to it.
- **Profile analysis:** TraceSift findings for local CPU and React profiles.

## Install

Install directly from the `release/antigravity` branch with the `agy` CLI:

```sh
agy plugin install https://github.com/callstackincubator/mobile-dev/tree/release/antigravity/mobile-dev
```

Or package and install from a local checkout:

```sh
npm run build
npm run package:antigravity
agy plugin install ./release/antigravity-plugin/mobile-dev
```

Open the **Mobile Dev** icon in the Antigravity Auxiliary Pane or ask Antigravity to
open your app on a simulator.

## Requirements

- An Apple Silicon Mac.
- **Node.js 22.19 or later.** Mobile Dev looks for it on `PATH` and in the usual
  Homebrew, nvm, fnm, Nix, Volta, mise, and asdf locations.
- **iOS:** Xcode 26 or later with an installed simulator runtime. Physical iPhone
  logs need Xcode 27 or later.
- **Android:** Android SDK platform-tools and emulator, and an AVD or a device with
  USB or wireless debugging authorized.

## What it runs on your Mac

The plugin bundles most of its runtimes and native helpers, so no `npm install`,
account, or hosted service is needed. Your project's own tools build the app. Besides
its Node.js server and Auxiliary Pane sidecar proxy, it runs:

- **The device panel's runtime, downloaded once.** The first time you open the panel,
  Mobile Dev downloads one archive from this project's GitHub release for the
  installed version (`mobile-dev-<version>-panel-runtime-darwin-arm64.tar.gz`). The
  plugin pins the archive's size and SHA-256 checksum and refuses any other file. It
  is unpacked into Antigravity's plugin data folder (`PLUGIN_DATA`), or
  `~/Library/Caches/mobile-dev` elsewhere, and kept across sessions.
- **A loopback page and sidecar proxy for the panel:** while the panel is open, the
  server serves it on `127.0.0.1` at a random port behind a private link, and
  `sidecars/launch.mjs` proxies it into the Antigravity Auxiliary Pane authenticated
  with `ANTIGRAVITY_SIDECAR_UI_TOKEN`.
- **agent-device**, its bundled Node.js runtime, for device control.
- **Native helpers** for physical iPhone logs, iOS FPS, and Android CPU/FPS
  collection.
- **Developer tools** already on your Mac: `xcrun simctl`, `devicectl`, `adb`, and the
  Android emulator, and TraceSift when you analyze a profile.

## Privacy and support

Mobile Dev reports plugin errors, crashes, usage counters, sampled traces, and
aggregate plugin performance measurements to Sentry by default. App logs,
screenshots, input content, tool payloads, app storage contents, profiles, and device
performance recordings are excluded from that telemetry. Set `MOBILE_DEV_TELEMETRY=off`
in the environment Antigravity starts from, then restart Antigravity, to turn reporting
off. Read the [Privacy Policy](PRIVACY.md) and [Terms of Service](TERMS.md).

For help, email [hello@callstack.com](mailto:hello@callstack.com) or see
[Support](SUPPORT.md).

## License

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
