# Mobile Dev for Claude

Build, run, and debug iOS and Android apps without leaving Claude. Mobile Dev
streams simulators, emulators, and connected devices into the chat and gives
Claude tools to see and control them. It works with Expo, React Native, SwiftUI,
and other native mobile projects.

- **Live devices beside your chat:** stream iOS simulators, Android emulators,
  and connected iPhones, iPads, and Android devices.
- **Device control and inspection:** let Claude tap, type, scroll, and read the
  accessibility tree, and annotate elements with instructions for it.
- **App control:** install, launch, and stop apps, open deep links, send test
  pushes, and set permissions and languages.
- **Device settings:** appearance, text size, rotation, location, status bar,
  and slow or offline networks.
- **Logs:** iOS unified logs, Android logcat, and Metro console messages in one
  filterable view.
- **Performance:** CPU, memory, and FPS charts, with recordings Claude can analyze
  and compare.
- **App storage:** browse and watch what your app saves, without adding code to it.

## Install

In Claude Code:

```sh
claude plugin marketplace add callstackincubator/codex-mobile-dev-plugin@release/claude
claude plugin install mobile-dev@mobile-dev
```

Start a new session and ask **"Open Mobile Dev."** Approve the tool calls when
prompted. Run `claude plugin update mobile-dev@mobile-dev` to update.

## Requirements

- An Apple Silicon Mac.
- **Node.js 22.19 or later.** Mobile Dev looks for it on `PATH` and in the usual
  Homebrew, nvm, fnm, Volta, mise, and asdf locations. If none is found, Claude
  tells you at the start of a session; install it with `brew install node` or
  from [nodejs.org](https://nodejs.org), then restart Claude.
- **iOS:** Xcode 26 or later with an installed simulator runtime. Physical
  devices need Xcode 27 or later and Developer Mode.
- **Android:** Android SDK platform-tools and emulator, and an AVD or a device
  with USB or wireless debugging authorized.

The plugin bundles its device backends and native helpers, so no `npm install`,
account, or hosted service is needed. Your project's own tools build the app;
Mobile Dev supplies the device panel, inspection, logs, and performance tools.

## Privacy and support

Mobile Dev reports plugin errors, crashes, usage counters, and aggregate plugin
performance measurements to Sentry. App logs, screenshots, input content, tool
payloads, app storage contents, profiles, and performance recordings are never
included. Set `MOBILE_DEV_TELEMETRY=off` in the environment Claude starts from
to turn reporting off. Read the [Privacy Policy](PRIVACY.md) and
[Terms of Service](TERMS.md).

For help, email [hello@callstack.com](mailto:hello@callstack.com) or see
[Support](SUPPORT.md).

## License

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
