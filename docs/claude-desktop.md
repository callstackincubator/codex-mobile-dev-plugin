# Claude Desktop development preview

Uses the same MCP server, UI and native helpers as Codex. Requires an Apple Silicon
Mac, Node >=22.19 for development, and Xcode for iOS simulators. Android requires
the Android SDK. This is a local Desktop connector, not a remote service.

## Run from this checkout

After the normal first-time setup in [CONTRIBUTING.md](https://github.com/callstackincubator/codex-mobile-dev-plugin/blob/main/CONTRIBUTING.md):

```sh
npm run build
npm run claude:config
```

1. In Claude Desktop, open **Settings > Developer > Edit Config**.
2. Merge the `mobile-dev` entry from `.local-dev/claude-desktop-config.json` into
   the existing `mcpServers` object. Preserve any other servers. The generated
   paths are absolute and use the Node executable that ran the command.
3. Fully quit and reopen Claude Desktop. Start a new conversation and ask:
   **“Open Mobile Dev. List available iOS simulators without booting anything.”**
4. Allow the app when prompted. Use **Expand** if Claude advertises fullscreen.

After source changes, rebuild and fully restart Claude to clear its resource
cache. This recipe uses rebuild/restart rather than setting up a UI watcher. If
you move the checkout or change Node installation, regenerate the config snippet.

## Install a bundle instead

```sh
npm run build
npm run package:claude
npm run test:claude
```

The output is `release/mobile-dev-<version>-claude-desktop-darwin-arm64.mcpb`.
In Claude Desktop, choose **Settings > Extensions > Advanced settings > Install Extension…**,
select the file, and confirm installation. You can also open it with Claude Desktop.
It includes the shared runtime and native helpers; Claude supplies Node. Do not also configure the
checkout connector above, or two Mobile Dev servers will appear.

This development bundle preserves the development telemetry environment. A
public release must use `npm run build:release` and
`npm run package:claude -- --release`, plus the existing source-map/native-symbol
upload process. The packager refuses a mismatched build environment.

## Compatibility and remaining checks

- Opens through a tool call in the conversation; no Codex sidebar shortcut.
- Native device-choice form is omitted. Claude must ask in chat when the target
  is ambiguous; the existing in-app device picker remains available.
- Codex update checks and installation are disabled, including UI polling.
  Reinstall a rebuilt bundle to update.
- Logs and annotations use standard context updates when advertised. Images
  additionally require image-context support. The top attachment bar lists saved
  notes and provides **Add notes to chat** and **Clear attachments**; Codex keeps
  its native chips and device-level send controls.
- **Add notes to chat** prepares a readable draft with the note text and targets.
  Selection details and editing guidance stay in model context. Review and send
  the draft in Claude before clearing notes. Claude may show a warning for
  app-generated drafts. Notes remain until explicitly removed or cleared.
- Claude may fetch model context on demand using its own **Reading widget context**
  action. This is separate from listing this server's MCP resources. The draft
  and Claude tool descriptions direct it to read widget context before acting,
  and to ask for the widget to be reopened if that context is unavailable.
  Verify the handoff by asking for a saved note's exact identifier and bounds;
  label matching against a fresh accessibility tree does not prove delivery.
  See the [upstream explanation](https://github.com/anthropics/claude-ai-mcp/issues/102).
- Other Ask/Investigate actions send complete standard messages; OpenAI routing is included
  only when the host advertises it. Codex skills are not installed by this bundle.

`test:claude` extracts the bundle into a temporary path and verifies MCP startup,
tool/resource discovery, disabled Codex features and telemetry metadata without
booting devices. It does not prove Claude renders the app or streams a device.

Remaining live checks in Claude Desktop:

- Confirm inline height, Expand/Back to chat, theme and popup placement.
- Stream and interact with an iOS simulator, then close/reopen the app to check cleanup.
- Test Android H.264 and physical-iOS HEVC separately; their WebCodecs support is host-dependent.
- Confirm one log/annotation question and, when advertised, one image attachment
  reaches Claude. Verify local clearing and clipboard actions.

Basic operation in Claude Desktop has been manually confirmed. The checks above
remain the checklist for broader device, codec, and interaction coverage; the
automated checks do not establish full end-to-end compatibility.

Sources: [Claude local MCP Apps setup](https://claude.com/docs/connectors/building/mcp-apps/getting-started),
[MCPB manifest](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md).
