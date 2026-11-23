---
title: Getting started
description: Install Mobile Dev in ChatGPT, Codex, Claude, Cursor, T3 Code, or another compatible MCP environment, then connect an iOS or Android device.
---

Install Mobile Dev for your development environment, open a new conversation, and ask **“Open Mobile Dev.”** Choose a device in the panel, then continue with your app project.

## Requirements

Codex desktop supports Android on Windows and Apple Silicon Macs. Local iOS tools require an Apple Silicon Mac. Install the platform tools for the devices and features you use.

| Target or feature | Requirement |
| --- | --- |
| iOS simulator | Xcode 26 or later, with an installed simulator runtime |
| Physical iPhone or iPad | Xcode 27 or later, a paired device, Developer Mode, and USB or Wi-Fi connectivity |
| Android | Android SDK Platform-Tools for physical devices. For AVDs, also install Android Emulator and a system image |
| Android screen streaming | A host with H.264 WebCodecs decoding |
| Physical iOS screen mirroring | A host with HEVC WebCodecs decoding |
| Metro logs and React Native inspection | An existing local Metro server with a compatible app inspector target |
| Physical iOS CPU and memory | iOS 17.4 or later, a running development-signed app with `get-task-allow`, a mounted developer disk image, and Xcode/LLDB detached |
| TraceSift profile analysis (macOS or Linux) | A local TraceSift installation, available on `PATH` or through `TRACE_SIFT_COMMAND` |

For local iOS devices, select the full Xcode installation in **Xcode Settings → Locations → Command Line Tools**.

### Set up Android

1. In [Android Studio](https://developer.android.com/studio), open **SDK Manager → SDK Tools** and install **Android SDK Platform-Tools**. Note the **Android SDK Location** shown in SDK Manager.
2. For an emulator, also install **Android Emulator**, then create an AVD in **Device Manager** and choose a system image. For a phone, enable **USB debugging** and accept the authorization prompt, or pair it for wireless debugging. [Virtual device setup](https://developer.android.com/studio/run/managing-avds) · [Physical device setup](https://developer.android.com/studio/run/device)
3. If you use a custom SDK location, set `ANDROID_HOME` to that folder and fully restart your host app. Mobile Dev checks `%LOCALAPPDATA%\Android\Sdk` on Windows, `~/Library/Android/sdk` on macOS and `~/Android/Sdk` on Linux by default. [Android SDK environment variables](https://developer.android.com/tools/variables)

## ChatGPT and Codex

[Open Mobile Dev in the ChatGPT plugin store](https://chatgpt.com/plugins/plugins_6ac4c117f76881918d3676e851fa4005). ChatGPT and Codex share the same listing. Install the plugin in the desktop app, then start a new chat and ask **“Open Mobile Dev.”**

The prebuilt Codex plugin uses the app's bundled Node runtime. On Windows, follow [Set up Android](#set-up-android), then open the Android tab and choose your emulator or phone. [OpenAI's plugin installation guide](https://learn.chatgpt.com/docs/plugins)

### Codex CLI

You can also install the repository's prebuilt release marketplace:

```sh
codex plugin marketplace add https://github.com/callstackincubator/mobile-dev.git --ref release/latest
codex plugin add mobile-dev@mobile-dev
```

When an update is offered in the desktop app, click **Update**, then fully quit and reopen it.

## Claude

Claude has two places that load Mobile Dev, and each has its own installation:

| Where you chat with Claude | What to install |
| --- | --- |
| **Claude Code**: the `claude` CLI, the **Code** tab in the Claude desktop app, IDE extensions, and hosts that run Claude Code, such as [T3 Code](#t3-code) | The [Claude Code plugin](#claude-code) |
| **Claude Desktop chats**: the regular chat in the Claude desktop app | The [Claude Desktop extension](#claude-desktop) |

Install one of them per place. Both use the same server, so avoid installing the plugin and a local connection side by side.

### Claude Code

The plugin is published as a Claude Code marketplace on this repository's `release/claude` branch. On an Apple Silicon Mac with Node.js 22.19 or later, run these commands in a terminal:

```sh
claude plugin marketplace add https://github.com/callstackincubator/mobile-dev.git#release/claude
claude plugin install mobile-dev@mobile-dev
```

Or let your agent do the setup:

<button type="button" class="copy-prompt" data-copy="Install the Mobile Dev Claude Code plugin for me on my Apple Silicon Mac. Run `claude plugin marketplace add https://github.com/callstackincubator/mobile-dev.git#release/claude` and then `claude plugin install mobile-dev@mobile-dev`. Confirm with `claude plugin list` that mobile-dev is installed and enabled. Check Node.js with `node --version` (22.19 or later). For Android, check that the SDK provides adb. For iOS, check the selected Xcode with `xcode-select -p`. Then tell me to start a new Claude Code session and ask it to open Mobile Dev. If I use T3 Code, also tell me to turn off Settings → Devices → Use devices there first.">Copy setup prompt</button>

### Claude Desktop

For regular chats in the Claude desktop app, download `mobile-dev-<version>-claude-desktop-darwin-arm64.mcpb` from the [latest release](https://github.com/callstackincubator/mobile-dev/releases/latest).

1. Open **Settings → Desktop app** and choose **Manage** beside **Extensions**.
2. Open **Advanced settings**. Under **Extension Developer**, choose **Install Extension…** and select the `.mcpb` file. You can also open the bundle with Claude Desktop.
3. Fully quit and reopen Claude, start a new conversation, and ask **“Open Mobile Dev.”**
4. Approve the connector when prompted. Choose **Expand** for the larger view when available.

The bundle includes the server and native helpers; Claude supplies Node. Install a newer bundle to update. Mobile Dev does not add a permanent Claude sidebar entry.

See [Claude's desktop extension instructions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) for the current custom-extension installation flow.

For a local connection, first complete the repository's [Build and package setup](https://github.com/callstackincubator/mobile-dev/blob/main/CONTRIBUTING.md#build-and-package). Then run these commands from that checkout with Node.js 22.19 or later:

```sh
npm run build
npm run claude:config
```

Merge the generated `.local-dev/claude-desktop-config.json` entry into the existing `mcpServers` configuration through **Settings → Developer → Edit Config**, preserving other servers. Restart Claude after changing the server.

## Cursor

The Cursor plugin is a manual preview for Apple Silicon Macs. It requires Node.js 22.19 or later on `PATH`.

1. Obtain the `mobile-dev` Cursor plugin folder from the person sharing the preview, or [build it from source](https://github.com/callstackincubator/mobile-dev/blob/main/CONTRIBUTING.md#cursor-local-development).
2. Copy it to `~/.cursor/plugins/local/mobile-dev`.
3. Run **Developer: Reload Window**, or restart Cursor. Confirm Mobile Dev appears under **Customize**.
4. Start a new agent chat and ask **“Open Mobile Dev.”**

After completing the repository's source-build setup, `npm run package:cursor` writes the plugin folder to `release/cursor-plugin/mobile-dev`. Copy a newer folder and reload to update.

Cursor must allow local plugin imports. On managed Enterprise accounts, your admin controls that setting. See [Cursor's local plugin instructions](https://prod.cursor.com/docs/plugins#test-plugins-locally).

For a local MCP connection, run `npm run build` and `npm run cursor:config` from the checkout. Merge the generated `.local-dev/cursor-mcp.json` entry into the `mcpServers` object in your global `~/.cursor/mcp.json`, then reload Cursor. Preserve your other servers and use either the plugin or this local connection.

## T3 Code

[T3 Code](https://github.com/pingdotgg/t3code) runs Claude Code and Codex, so it loads the Mobile Dev plugin that each of them has installed. Install the plugin for the provider you use, on the Mac that runs T3 Code. In both, the panel opens in T3 Code's Browser.

### 1. Turn off T3 Code's device tools

In **Settings → Devices**, turn off **Use devices**, which also turns off **Agents can use devices**. Otherwise T3 Code gives agents its own `device_*` tools, with the same names as Mobile Dev's, and tells them to prefer those tools.

### 2. Install the plugin

For **Claude threads**, run these commands in a terminal on that Mac, outside T3 Code:

```sh
claude plugin marketplace add https://github.com/callstackincubator/mobile-dev.git#release/claude
claude plugin install mobile-dev@mobile-dev
```

Claude threads need no further setting.

For **Codex threads**, install the [Codex plugin](#codex-cli), then add one setting, because T3 Code otherwise renders Codex's panel in the chat and asks you to confirm each action that the panel takes, such as each tap:

1. Open **Settings → Providers**, then the Codex instance.
2. Under **Variables**, click **Add variable**. Set `MOBILE_DEV_PANEL` to `browser`.

### 3. Open Mobile Dev

Start a **new** thread with the Claude or Codex provider, so it loads the plugin, and ask **“Open Mobile Dev.”** The agent opens the panel with T3 Code's `preview_open` tool, and T3 Code shows the page as a floating preview. To dock the panel beside the chat, click the preview's **Open in right panel** button. The first open downloads the panel's runtime once, which can take a minute.

Setup worked when the panel shows Mobile Dev's device list. Choose a simulator or emulator there, and it boots and streams in the panel. Performance recordings still render as cards in the chat.

## Other environments

The shared server supports local MCP connections over stdio. After completing the [source-build setup](https://github.com/callstackincubator/mobile-dev/blob/main/CONTRIBUTING.md#build-and-package), configure your client's local MCP server connection to launch Node.js 22.19 or later with the absolute path to the built `dist/server.mjs` as its argument. Keep the built distribution and its bundled helpers together.

Follow your client's configuration format. Device panels and interactive recording cards require MCP Apps support; available chat actions depend on the capabilities the client advertises. In clients without panels, the agent can use the device and inspection tools through chat.

## Your first app

1. Ask **“Build and run my app in the simulator beside this chat.”** You can name iOS, Android, a simulator model, or a connected device.
2. Choose or reuse a device. Selecting a stopped simulator or AVD boots it.
3. Watch the app beside the conversation. Use **Select** to annotate an element, or open **Tools** and choose **App Intel**, **Testing Studio**, **Logs**, **Performance**, **Storage**, or **TraceSift**. App Intelligence requires Mobile Dev 0.1.183 or later; if **App Intel** is missing, update Mobile Dev, fully quit and reopen your host, then start a new conversation.

Your app's own build tools compile, install, and launch it. Mobile Dev does not install Xcode runtimes or replace your project's build system.

Continue with [Devices](/docs/devices) or [App control](/docs/app-control).
