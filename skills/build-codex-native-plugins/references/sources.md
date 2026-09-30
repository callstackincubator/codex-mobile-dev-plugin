# Sources and version checks

This skill was checked on 2026-09-29 against the official guides and `openai/mcp-extensions` commit `e314720a0daac326217d1f123fcf51647868fa9f`. The extension SDKs were at `0.1.0`. These are a record of the check, not a command to pin future projects to those versions.

## Start with these sources

- [Build plugins on ChatGPT Learn](https://learn.chatgpt.com/docs/build-plugins) explains the conversation-based creator, workspace access, editing, testing, and sharing.
- [OpenAI MCP Extensions](https://github.com/openai/mcp-extensions) contains the SDKs and native extension example.
- [Protocol specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md) defines the wire format and platform table.
- [TypeScript SDK guide](https://github.com/openai/mcp-extensions/blob/main/typescript/README.md) covers server and app APIs.
- [Python SDK guide](https://github.com/openai/mcp-extensions/blob/main/python/README.md) covers server APIs.
- [Bits & Bolts](https://github.com/openai/mcp-extensions/tree/main/plugins/bits-and-bolts) shows a bundled sidebar app, file editor, settings, forms, and mentions.

## Builder docs by task

| Task | Official guide |
| --- | --- |
| All builder topics | [Plugins documentation index](https://developers.openai.com/plugins/llms.txt) |
| Package format and marketplaces | [Package your plugin](https://developers.openai.com/plugins/build/plugins) |
| Native features | [Plugin extensions](https://developers.openai.com/plugins/build/extensions) |
| Server contracts and skill import | [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server) |
| Workflow instructions | [Build skills](https://developers.openai.com/plugins/build/skills) |
| Tool design | [Define tools](https://developers.openai.com/plugins/plan/tools) |
| HTML resources, CSP, and state | [Add UI](https://developers.openai.com/plugins/build/chatgpt-ui) |
| Initial UI server | [MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart) |
| OAuth and account identity | [Authentication](https://developers.openai.com/plugins/build/auth) |
| Webhook subscriptions | [MCP Events](https://developers.openai.com/plugins/build/mcp-events) |
| Host connection and refresh | [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt) |
| Public ZIP and review | [Submit your plugin](https://developers.openai.com/plugins/deploy/submission) |
| Errors | [Troubleshooting](https://developers.openai.com/plugins/deploy/troubleshooting) and [submission errors](https://developers.openai.com/plugins/deploy/submission-errors) |
| Public review policy | [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) and [MCP review](https://developers.openai.com/plugins/deploy/app-review) |
| Security and data handling | [Security and privacy](https://developers.openai.com/plugins/guides/security-privacy) |
| Local lifecycle hooks | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Workspace distribution | [Plugin management](https://learn.chatgpt.com/docs/enterprise/plugin-management) |

Official pages have Markdown versions at the same URL with `.md` appended. If a web reader returns only navigation, fetch that version. Use the docs index to find moved pages. A search excerpt may show an older submission flow.

## SDK compatibility snapshot

| Package | Requirements found in the checked source |
| --- | --- |
| `@openai/mcp-extensions` | Node.js 22+, `@modelcontextprotocol/sdk ^1.29.0`; optional MCP Apps peer `@modelcontextprotocol/ext-apps ^1.7.5` |
| `openai-mcp-extensions` | Python 3.10+, `mcp >=2.0.0b2`, `mcp-types >=2.0.0`, Pydantic 2 |
| App-side SDK for a Python server | The TypeScript `/app` package still supplies browser APIs |

Read the project's lockfile and the installed package exports before writing imports. The Python examples use the MCP 2 beta `MCPServer` and `Apps` interfaces. Older `FastMCP` examples need a deliberate port; replacing import names is not enough.

## Resolve source differences

Use the package schema for manifest shape, the protocol spec for wire behavior, and the installed SDK source for helpers that exist in that version. Use the current submission guide for portal limits.

Known differences at the checked commit:

- The spec describes global, thread, and file entrypoints. SDK schemas and the extension guide also expose a custom `settings` entrypoint and global `quickAction`.
- The SDK's display-mode schema accepts `pip`; the host support section says ChatGPT currently supports `inline` and `fullscreen`.
- The current creator and Bits & Bolts use the supported compatibility manifest. The packaging guide recommends the portable root format for new packages.
- Legacy form examples describe direct MCP connections. They do not establish MRTR support for registered servers.
- Old submission examples may mention a separate "With MCP" route. The current guide starts with a plugin ZIP and then connects its declared MCP server in the dashboard.

Follow the narrower host contract when code can represent more than the host supports. Record the version and limitation if a needed behavior remains unclear.
