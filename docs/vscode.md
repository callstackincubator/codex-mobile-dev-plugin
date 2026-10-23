# VS Code / GitHub Copilot development preview

Runs the shared Mobile Dev MCP server and native helpers on an Apple Silicon
Mac. Requires Node >=22.19, Xcode for iOS and the Android SDK for Android.
Use a current VS Code with GitHub Copilot and MCP Apps enabled
(`chat.mcp.apps.enabled`). This preview has automated protocol/package coverage;
actual VS Code rendering, device streaming and input still need validation.

## Run from source

Complete repository setup, then:

```sh
npm run build
npm run vscode:config
```

Use **MCP: Open User Configuration** and merge the `servers` entry from
`.local-dev/vscode-mcp.json`. Preserve existing servers. Alternatively use your
app project's `.vscode/mcp.json`. For SSH/dev-container work, keep this stdio
server in the **local** user profile so it can reach the Mac's Xcode/ADB/devices.
The generated Node and server paths are absolute. Restart the MCP server after
rebuilding; regenerate configuration after moving the checkout or Node.

Ask: **Open Mobile Dev and list available devices without booting anything.**
Choose ambiguous targets in chat or in the device picker.

## Relocatable bundle

```sh
npm run package:vscode
npm run test:vscode
```

Unzip `release/mobile-dev-<version>-vscode-darwin-arm64.zip` into a persistent
directory, run `node configure.mjs` there, then merge the printed configuration
into VS Code. It uses the Node running that command and requires no Codex
installation. Replace the bundle and restart the server to update. Codex update
checks and installation are disabled. This is an MCP bundle, not a VSIX.

Local builds retain development telemetry. Public packaging requires
`npm run build:release` and `npm run package:vscode -- --release`, plus the normal
source-map and native-symbol upload workflow.

## VS Code behavior

- The workspace runs inline at a reported bounded height, with responsive
  device/tools layout. It declares only inline mode. A docked editor panel or
  fullscreen workspace would require separate VS Code extension work.
- **Prepare question** / **Prepare investigation** fills the chat input. Review
  the text and press **Send** to start. Logs, screenshot context and annotations
  remain selected until explicitly cleared; a prepared question is not a sent
  turn. Questions include their selected log/recording details.
- The explicit VS Code profile accommodates versions that handle `ui/message`
  but omit `message.text`, and context updates without a `text` subcapability.
  Other hosts retain capability checks. Rejections/timeouts are shown without
  automatically retrying an uncertain handoff. Existing copy actions remain.

## Validation before declaring support

- Open an existing iOS simulator, stream for five minutes, tap and drag.
- Confirm the inline height, keyboard/menu behavior and device/tool selectors.
- Prepare a log/annotation/recording question, verify it does not submit, then
  submit manually and check the agent receives the correct device and reference.
- Check image attachments and explicit clearing, including a manually removed
  composer attachment. Standard context provides no composer readback; local
  selections remain app-owned and can be published again on a later update.
- Hide/reopen cards, switch chats and verify collectors and observers clean up.
- Validate Android H.264 and physical-iOS HEVC independently of simulator JPEG.

The smoke test relocates the archive into a path with spaces and verifies MCP
startup, UI resources, telemetry opt-out and update isolation without booting
devices. Existing stream/input telemetry remains; prepared-message outcomes use
separate counters described in `docs/telemetry.md`.

Source: [VS Code MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp).
