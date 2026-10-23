# Cursor development preview

Runs the shared Mobile Dev MCP server and native helpers on an Apple Silicon
Mac. Requires Node >=22.19, Xcode for iOS and the Android SDK for Android.
Cursor 2.6 introduced MCP Apps; use a current desktop version with Apps enabled.
This preview has automated protocol/package coverage. Actual Cursor rendering,
stream throughput and device interaction still require the checks below.

## Run from source

Complete the normal repository setup, then run:

```sh
npm run build
npm run cursor:config
```

Merge the generated `.local-dev/cursor-mcp.json` server entry into
`~/.cursor/mcp.json` or your app project's `.cursor/mcp.json`. Preserve other
servers. The generator records absolute Node and server paths, so it does not
depend on Cursor's working directory or shell PATH. Restart the server in Cursor
after rebuilding. Regenerate configuration after moving the checkout or Node.

Ask: **Open Mobile Dev and list available devices without booting anything.**
Choose the target in chat or in the device picker. Expand is available only when
the host advertises fullscreen. Codex update checks and installation are disabled.

## Relocatable bundle

```sh
npm run package:cursor
npm run test:cursor
```

Unzip `release/mobile-dev-<version>-cursor-darwin-arm64.zip` into a persistent
directory. Run `node configure.mjs` there and merge the printed configuration into
Cursor. It uses the Node executable running that command; no Codex installation
is required. Re-run configuration if the directory or Node moves. Replace the
bundle and restart its server to update.

The bundle also contains a Cursor plugin manifest and `mcp.json` using
`${CURSOR_PLUGIN_ROOT}`. That plugin route requires Node on Cursor's PATH.
Do not enable both installation routes. Marketplace submission is separate from
creating this archive; no marketplace publication is implied.

Local builds retain development telemetry. Public packaging requires
`npm run build:release` followed by `npm run package:cursor -- --release`, plus
the normal source-map and native-symbol upload workflow.

## Validation before declaring support

- Open an existing iOS simulator, stream for five minutes and verify tap/drag.
- Attach a log, screenshot and annotation; verify exactly what reaches chat.
- Record CPU/memory and ask about a selected range, checking the reference.
- Hide/reopen the card, switch chats and disconnect/reconnect the device.
- Test Android H.264 and physical-iOS HEVC separately from simulator JPEG.
- Check local-server policy permits required native helpers, ADB and local
  sockets. The server must run on the Mac with the devices, not a cloud agent.

The smoke test extracts into a path with spaces and verifies startup, UI metadata,
configuration relocation, telemetry opt-out and disabled Codex updates without
booting devices. Existing streaming, input and context telemetry is preserved.

Sources: [Cursor MCP](https://cursor.com/docs/mcp),
[Cursor plugin reference](https://cursor.com/docs/reference/plugins).
