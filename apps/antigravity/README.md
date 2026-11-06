# Mobile Dev for Antigravity

Build, run, and debug iOS and Android apps without leaving Antigravity. Mobile Dev
streams your simulators, emulators, and devices into an Antigravity Auxiliary Pane
(`mobile-dev.device-panel`) beside the chat, and gives Antigravity the tools to
control them, read their logs, inspect your app, and measure its performance. It
works with Expo, React Native, SwiftUI, and other native mobile projects.

- **Auxiliary Pane device panel:** a live, interactive iOS simulator, Android
  emulator, or connected device in the Antigravity side pane, with logs and
  performance tools beside it. Antigravity reads the devices you select there and the
  logs, screenshots, and notes you add to chat.
- **Device control and inspection:** Antigravity taps, types, scrolls, reads the
  accessibility tree, and takes screenshots through the bundled
  [agent-device](https://agent-device.dev/) runtime.
- **App control:** install, launch, and stop apps, open deep links, send test pushes,
  and set permissions and languages.
- **App Flow:** a visual map of your app's screens and the navigation between them,
  read from your Expo Router or React Navigation source and optionally captured by
  walking the app on an iOS simulator.
- **Logs:** iOS unified logs, Android logcat, physical iPhone logs, and Metro console
  messages.
- **Performance:** CPU, memory, and FPS recordings shown as interactive charts in
  chat, which Antigravity can analyze and compare.
- **App storage:** read what your app saved, such as UserDefaults, SharedPreferences,
  AsyncStorage, MMKV, and SQLite, without adding code to it.
- **Profile analysis:** TraceSift findings for local CPU and React profiles.

## Install

Install directly from the `release/antigravity` branch with the `agy` CLI:

```sh
agy plugin install https://github.com/callstackincubator/codex-mobile-dev-plugin/tree/release/antigravity/mobile-dev
```

Or package and install from a local checkout:

```sh
npm run build
npm run package:antigravity
agy plugin install ./release/antigravity-plugin/mobile-dev
```

Open the **Mobile Dev** icon in the Antigravity activity bar (Auxiliary Pane) or ask
Antigravity to open your app on a simulator.

## Requirements

- An Apple Silicon Mac.
- **Node.js 22.19 or later.** Mobile Dev looks for it on `PATH` and in the usual
  Homebrew, nvm, fnm, Nix, Volta, mise, and asdf locations.
- **iOS:** Xcode 26 or later with an installed simulator runtime. Physical iPhone
  logs need Xcode 27 or later.
- **Android:** Android SDK platform-tools and emulator, and an AVD or a device with
  USB or wireless debugging authorized.

## License

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
