---
name: mobile-dev-setup
description: Set up the Mobile Dev plugin's bundled iOS and Android backends and check local device tools.
---

# Set up Mobile Dev

The installed plugin contains Baguette 0.2.1, its resource bundle, agent-device 0.20.9 with its dependencies and Apple runner source, and the built MCP servers and panel. Do not install Baguette with Homebrew, install a global agent-device CLI, or start separate servers.

First resolve Mobile Dev tools through the host's tool discovery when available.
If `mobile_open_simulator` and the device-list tools are unavailable, tell the user:
"Mobile Dev could not start. I'll check its setup." Follow
[missing-tools recovery](references/missing-tools.md) before stopping: run the
installed launcher's version check yourself, explain its result, and offer a
repair through the user's existing Node manager. Do not leave the user with
terminal commands to diagnose the problem when you can run the checks. A generic
startup timeout alone does not justify increasing the timeout. Stop device setup
until the tools are available; do not claim that the chat was created too early
without evidence or work around the failure with another device backend.

1. Call `mobile_open_simulator` to open the panel beside the chat, or reuse an open Mobile Dev panel. Use `mobile_open_workspace` if the user asks for fullscreen. For an explicit tool-only workflow or a host without panels, use the device-list tools instead. The iOS tools start the bundled backend on a private loopback port and list simulators.
2. If the backend fails, read the returned error. Check that this is an Apple Silicon Mac and that `xcode-select -p` points to Xcode 26 or later. Use `xcodebuild -version` when needed. Check that the configured user login shell resolves Node.js 22.18 or later. The shell launcher reports discovery and version failures in MCP startup logs; use that exact error to explain the setup requirement.
3. If no devices appear, have the user add an iOS runtime in Xcode's Settings, Components. A runtime download can be large, so do not start it without the user's request.
4. Follow the user's device choice; otherwise reuse a compatible device shared by the panel, then a suitable booted simulator. For app development, choose and boot a suitable installed simulator if none runs. Pick among equivalent devices yourself; ask only when a device choice changes what the task needs and the project gives no answer. Setup alone does not require booting a device. Confirm tool connectivity with `mobile_list_simulators`.
5. Agent Device is temporarily disabled while iterating on inline performance charts. Use the Mobile Dev tools for device discovery, screenshots, logs and performance; do not search for Agent Device tools or start its CLI separately.

No account, token, tunnel, or hosted service is needed. Do not repeat setup after a successful connection.

For source development, `npm run vendor:baguette` downloads the pinned official archive, checks its SHA-256, and rebuilds the same source with Swift 6.4 or later to avoid macOS 27 crashes. Preparing Baguette requires Xcode 27 and Git. `npm run vendor:agent-device` installs agent-device and its dependencies from the runtime lockfile without package scripts. `npm run build` copies both runtimes into `dist`, and `npm run package` creates a local marketplace and a ZIP. The installed package needs neither npm nor the source checkout.

## Android setup

The package also contains a checked-in Node.js fork of serve-emu 0.0.6, its Node dependencies, and scrcpy 4.0. Android uses the plugin’s Node.js 22.18 or later runtime and needs Android SDK platform-tools and emulator, and an AVD or authorized attached device. Check `node --version` and `mobile_list_android_devices`. The SDK lookup checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `~/Library/Android/sdk`, then PATH.

Open or reuse the panel for Android work. Call `mobile_list_android_devices` to discover devices; listing does not boot them. Follow the user's choice or reuse a compatible device shared by the panel. For app development, reuse a suitable running emulator or choose an installed AVD and call `mobile_boot_android_emulator` if needed. Pick among equivalent AVDs yourself; ask only when the choice changes what the task needs. The user can also enable Android in the panel toolbar and select an AVD to boot and stream it. Use the returned running serial with the Mobile Dev Android tools. The panel needs WebCodecs H.264 support. Do not install a global serve-emu package or start a second app dev server.

For source development, run `npm run vendor:serve-emu` before building. It installs the fork’s pinned Node dependencies with scripts disabled and checks the scrcpy server hash. The build copies the runtime to `dist/serve-emu`; the installed package needs no npm download.
