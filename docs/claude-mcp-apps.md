# Claude MCP Apps support

Reviewed on November 11, 2026 against all 13 pages in Claude's
[MCP Apps guide](https://claude.com/docs/connectors/building/mcp-apps/getting-started).
Mobile Dev ships a local stdio server. Claude Desktop can render its MCP Apps;
Claude Code uses its tools as text.

| Guide | Mobile Dev support |
| --- | --- |
| [Get started](https://claude.com/docs/connectors/building/mcp-apps/getting-started) | Shared MCP Apps tools and resources, the standard MIME type, and SDK `App.connect()` without a custom transport. |
| [Quickstart](https://claude.com/docs/connectors/building/mcp-apps/quickstart) | Input, result, host-context, and teardown handlers register before connecting. The UI loads from a bundled resource. |
| [Design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines) | Shared responsive workspace, host style tokens, inline chart cards, and all four safe-area insets. |
| [Display modes](https://claude.com/docs/connectors/building/mcp-apps/display-modes) | Both `inline` and `fullscreen`; resource preference requests the side panel. Expand follows a user click and the host's advertised modes. Layout follows the container size. |
| [Entry points](https://claude.com/docs/connectors/building/mcp-apps/entry-points) | Workspace and App Intelligence already carry both `ui.resourceUri` and global `openai/ui` entry points. Claude exposes these only for remote connectors, subject to account and organization access. |
| [App tools](https://claude.com/docs/connectors/building/mcp-apps/app-tools) | Claude cannot call UI-registered tools from local connectors. The plugin's server tools remain available, including device control and App Flow. Registering UI tools here would add no working feature. |
| [Messages](https://claude.com/docs/connectors/building/mcp-apps/send-messages) | User actions send complete text requests. Standard-host messages obey the 8,000-character and whitespace limits; oversized requests report an error without truncation. Draft acknowledgements retain context. Timeouts report uncertain delivery. Standard-host messages never retry in code. |
| [Embedded websites](https://claude.com/docs/connectors/building/mcp-apps/embedded-sites) | Local connectors cannot embed websites. The plugin serves its full UI directly, with no nested website or browser bridge. No `frameDomains` are needed. |
| [Downloads](https://claude.com/docs/connectors/building/mcp-apps/download-files) | Finished or failed recordings offer **Download JSON** in the workspace when the host advertises `downloadFile`. Exports include original samples, use embedded resource contents, allow one pending request, and distinguish refusal from uncertain delivery. |
| [Theming](https://claude.com/docs/connectors/building/mcp-apps/transparent-theming) | Host theme, variables, and fonts apply on connect and on changes. CSP allows Claude's font origin. The page declares both color schemes; inline cards leave their document background transparent. Workspaces retain their own host-themed surface. |
| [Instance supersession](https://claude.com/docs/connectors/building/mcp-apps/instance-supersession) | Each workspace opening gets a server-issued timestamp, sequence, and session scope. Same-origin views retire older workspaces and stop streams, polls, context writes, listeners, and telemetry. Keys come from tool results, so mounting an old result later cannot win. Saved chart cards remain independent. |
| [External links](https://claude.com/docs/connectors/building/mcp-apps/external-links) | The panel needs no external navigation. Local connectors cannot bypass Claude's link confirmation through a directory allowlist. |
| [Troubleshooting](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting) | Opening results stay small; chart details load on demand. The view connects before starting device work and reports a nonzero inline height. Local stdio resources omit `ui.domain`, which needs a remote connector URL. |

Side-panel access is still rolling out. Claude can keep a view inline, or open it
full screen where it supports that mode. Entry points, app tools, and embedded
websites also have rollout or listing rules; shipping their metadata cannot
remove the remote-server requirement.

Workspace replacement uses `BroadcastChannel` only within the same origin and
server scope. Hosts that block channels, and transcripts saved before the server
issued instance keys, retain the usual independent-view behavior. We do not use
client mount time as an ordering fallback or set a fixed sandbox domain.

Tests use the real servers in stand-in hosts and exercise the SDK handshake,
messages, teardown, downloads, and replacement of mounted workspaces. They do not
prove that a particular Claude account has received the side-panel rollout.
