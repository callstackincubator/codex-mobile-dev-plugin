---
title: Getting started
description: Install Mobile Dev in ChatGPT, Codex, Claude, Cursor, or another compatible MCP environment, then connect an iOS or Android device.
---

Install Mobile Dev for your development environment, open a new conversation, and ask **“Open Mobile Dev.”** Choose a device in the panel, then continue with your app project.

## Requirements

Mobile Dev runs on an **Apple Silicon Mac**. Install the platform tools for the devices and features you use.

| Target or feature | Requirement |
| --- | --- |
| iOS simulator | Xcode 26 or later, with an installed simulator runtime |
| Physical iPhone or iPad | Xcode 27 or later, a paired device, Developer Mode, and USB or Wi-Fi connectivity |
| Android | Android SDK platform-tools and emulator, plus an AVD or a physical device with authorized debugging |
| Android screen streaming | A host with H.264 WebCodecs decoding |
| Physical iOS screen mirroring | A host with HEVC WebCodecs decoding |
| Metro logs and React Native inspection | An existing local Metro server with a compatible app inspector target |
| Physical iOS CPU and memory | iOS 17.4 or later, a running development-signed app with `get-task-allow`, a mounted developer disk image, and Xcode/LLDB detached |
| Profile analysis | A local TraceSift installation, available on `PATH` or through `TRACE_SIFT_COMMAND` |

Select the full Xcode installation in **Xcode Settings → Locations → Command Line Tools**. Command Line Tools alone do not provide the required simulator tools.

## ChatGPT and Codex

[Open Mobile Dev in the ChatGPT plugin store](https://chatgpt.com/plugins/plugins_6ac4c117f76881918d3676e851fa4005). ChatGPT and Codex share the same listing. Install the plugin in the desktop app, then start a new chat and ask **“Open Mobile Dev.”**

Mobile Dev's local tools require the desktop app on an Apple Silicon Mac. The prebuilt plugin uses the app's bundled Node runtime. See [OpenAI's plugin installation guide](https://learn.chatgpt.com/docs/plugins) for the shared directory and installation flow.

### Codex CLI

You can also install the repository's prebuilt release marketplace:

```sh
codex plugin marketplace add https://github.com/callstackincubator/mobile-dev.git --ref release/latest
codex plugin add mobile-dev@mobile-dev
```

When an update is offered in the desktop app, click **Update**, then fully quit and reopen it.

## Claude

### Claude Desktop

Claude Desktop currently uses a manual preview. Obtain a `mobile-dev-<version>-claude-desktop-darwin-arm64.mcpb` bundle from the person sharing it, or [build a bundle from source](https://github.com/callstackincubator/mobile-dev/blob/main/CONTRIBUTING.md#claude-desktop-local-development). The bundle is not yet published by this repository's release workflow.

1. Open **Settings → Desktop app** and choose **Manage** beside **Extensions**.
2. Open **Advanced settings**. Under **Extension Developer**, choose **Install Extension…** and select the `.mcpb` file. You can also open the bundle with Claude Desktop.
3. Fully quit and reopen Claude, start a new conversation, and ask **“Open Mobile Dev.”**
4. Approve the connector when prompted. Choose **Expand** for the larger view when available.

The bundle includes the plugin and native helpers; Claude supplies Node. Install newer bundles manually to update. Mobile Dev does not add a permanent Claude sidebar entry.

See [Claude's desktop extension instructions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) for the current custom-extension installation flow.

For a local connection or bundle build, first complete the repository's [Build and package setup](https://github.com/callstackincubator/mobile-dev/blob/main/CONTRIBUTING.md#build-and-package). Then run these commands from that checkout with Node.js 22.19 or later:

```sh
npm run build
npm run claude:config
```

Merge the generated `.local-dev/claude-desktop-config.json` entry into the existing `mcpServers` configuration through **Settings → Developer → Edit Config**, preserving other servers. Restart Claude after changing the server.

### Claude Code

The source build can package a local Claude Code plugin:

```sh
npm run package:claude
claude plugin validate ./release/claude-plugin/mobile-dev
claude --plugin-dir ./release/claude-plugin/mobile-dev
```

Run these after the source-build setup above. The plugin requires Node.js 22.19 or later on `PATH`. Rich views depend on the host's MCP Apps capabilities. Use one Mobile Dev installation or local connection at a time to avoid duplicate servers.

## Cursor

Cursor currently uses a manual preview, not a Cursor Marketplace listing. It requires Node.js 22.19 or later on `PATH`.

1. Obtain the `mobile-dev` Cursor plugin folder from the person sharing the preview, or [build it from source](https://github.com/callstackincubator/mobile-dev/blob/main/CONTRIBUTING.md#cursor-local-development).
2. Copy it to `~/.cursor/plugins/local/mobile-dev`.
3. Run **Developer: Reload Window**, or restart Cursor. Confirm Mobile Dev appears under **Customize**.
4. Start a new agent chat and ask **“Open Mobile Dev.”**

After completing the repository's source-build setup, `npm run package:cursor` writes the plugin folder to `release/cursor-plugin/mobile-dev`. Copy a newer folder and reload to update.

Cursor must allow local plugin imports. On managed Enterprise accounts, your admin controls that setting. See [Cursor's local plugin instructions](https://prod.cursor.com/docs/plugins#test-plugins-locally).

For a local MCP connection, run `npm run build` and `npm run cursor:config` from the checkout. Merge the generated `.local-dev/cursor-mcp.json` entry into the `mcpServers` object in your global `~/.cursor/mcp.json`, then reload Cursor. Preserve your other servers and use either the plugin or this local connection.

## Other environments

The shared server supports local MCP connections over stdio. After completing the [source-build setup](https://github.com/callstackincubator/mobile-dev/blob/main/CONTRIBUTING.md#build-and-package), configure your client's local MCP server connection to launch Node.js 22.19 or later with the absolute path to the built `dist/server.mjs` as its argument. Keep the built distribution and its bundled helpers together.

Follow your client's configuration format. Device panels and interactive recording cards require MCP Apps support; available chat actions depend on the capabilities the client advertises. In clients without panels, the agent can use the device and inspection tools through chat.

## Your first app

1. Ask **“Build and run my app in the simulator beside this chat.”** You can name iOS, Android, a simulator model, or a connected device.
2. Choose or reuse a device. Selecting a stopped simulator or AVD boots it.
3. Watch the app beside the conversation. Use **Select** to annotate an element, or open **Logs**, **Performance**, **Storage**, or **TraceSift**.

Your app's own build tools compile, install, and launch it. Mobile Dev does not install Xcode runtimes or replace your project's build system.

Continue with [Devices](/docs/devices) or [App control](/docs/app-control).
