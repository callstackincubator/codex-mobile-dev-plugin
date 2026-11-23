---
name: mobile-dev-setup
description: Set up the Mobile Dev plugin's bundled iOS and Android backends and check local device tools.
---

# Set up Mobile Dev

The installed Codex plugin contains the Android streaming backend, agent-device 0.20.9, the MCP server and the panel. On an Apple Silicon Mac it also uses the bundled Baguette 0.2.1 backend for local iOS simulators. Use these bundled tools.

First resolve Mobile Dev tools through the host's tool discovery when available.
If `mobile_open_simulator` and the device-list tools are unavailable, tell the user:
"Mobile Dev could not start. I'll check its setup." Follow
[missing-tools recovery](references/missing-tools.md) before stopping: inspect the
installed configuration and startup failure, explain the result, and offer a
repair for that specific failure. Do not leave the user with
terminal commands to diagnose the problem when you can run the checks. A generic
startup timeout alone does not justify increasing the timeout. Stop device setup
until the tools are available; do not claim that the chat was created too early
without evidence or work around the failure with another device backend.

1. Call `mobile_open_simulator` to open the panel beside the chat, or reuse an open Mobile Dev panel. Use `mobile_open_workspace` if the user asks for fullscreen. For an explicit tool-only workflow or a host without panels, use the device-list tools instead.
2. For Android, including local device setup on Windows, follow [Android setup](#android-setup) and confirm connectivity with `mobile_list_android_devices`. On Windows the iOS tab explains that local iOS devices require macOS.
3. For a local iOS simulator on an Apple Silicon Mac, call `mobile_list_simulators`. If it fails, read the returned error and check the selected Xcode with `xcode-select -p` and `xcodebuild -version`. Simulators require Xcode 26 or later. If no runtime is installed, point the user to **Xcode Settings → Components**. Start a runtime download only when the user requests it.
4. Follow the user's device choice or reuse a compatible device shared by the panel. For app development, choose and boot a suitable installed virtual device if none runs. Pick among equivalent devices yourself. Ask only when a choice changes what the task needs and the project gives no answer. Listing devices is enough to confirm setup.
5. The `device_*` tools run the bundled agent-device runtime, which starts on the first command. Its first iOS interaction builds the XCTest runner with the local Xcode. When a command reports that Agent Device could not start or complete it, call `device_doctor` for the device and toolchain readiness it reports. Do not install agent-device or start its CLI separately.

No account, token, tunnel, or hosted service is needed. Do not repeat setup after a successful connection.

For source development, `npm run vendor:baguette` downloads the pinned official archive, checks its SHA-256, and rebuilds the same source with Swift 6.4 or later to avoid macOS 27 crashes. Preparing Baguette requires Xcode 27 and Git. `npm run vendor:agent-device` installs agent-device and its dependencies from the runtime lockfile without package scripts. `npm run build` copies both runtimes into `dist`, and `npm run package` creates a local marketplace and a ZIP. The installed package needs neither npm nor the source checkout.

## Android setup

The package contains serve-emu 0.0.6 and scrcpy 4.0. Call `mobile_list_android_devices` and use its setup guidance when the list is empty. If adb is missing, direct the user to **Android Studio → SDK Manager → SDK Tools → Android SDK Platform-Tools**. For an emulator, also install **Android Emulator**, then create an AVD with a system image in **Device Manager**. For a phone, enable USB debugging and accept the authorization prompt, or pair it for wireless debugging.

The plugin checks `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then the default SDK folder, and finally executables on `PATH`. The default it checks is `%LOCALAPPDATA%\Android\Sdk` on Windows, `~/Library/Android/sdk` on macOS and `~/Android/Sdk` on Linux. For a custom location, set `ANDROID_HOME` to the SDK root shown by SDK Manager and restart the host.

Open or reuse the panel for Android work. Call `mobile_list_android_devices` to discover devices; listing does not boot them. Follow the user's choice or reuse a compatible device shared by the panel. For app development, reuse a suitable running emulator or choose an installed AVD and call `mobile_boot_android_emulator` if needed. Pick among equivalent AVDs yourself; ask only when the choice changes what the task needs. The user can also enable Android in the panel toolbar and select an AVD to boot and stream it. Use the returned running serial with the Mobile Dev Android tools. The panel needs WebCodecs H.264 support. Do not install a global serve-emu package or start a second app dev server.

For source development, run `npm run vendor:serve-emu` before building. It installs the fork’s pinned Node dependencies with scripts disabled and checks the scrcpy server hash. The build copies the runtime to `dist/serve-emu`; the installed package needs no npm download.
