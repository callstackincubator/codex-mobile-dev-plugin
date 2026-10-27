# MCP servers and authentication

Use [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server), [Define tools](https://developers.openai.com/plugins/plan/tools), and the SDK guide for the chosen language. UI is optional. The tools should still return a useful result when no app renders.

## Choose transport and dependencies

Use stdio for a local bundled server and Streamable HTTP for a hosted server. Connect a private development server through a supported tunnel when needed. Public submission requires a stable public HTTPS endpoint; a temporary or Secure MCP Tunnel alone does not meet that requirement.

For a TypeScript app and server, install with the project's package manager:

```sh
npm install @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps @openai/mcp-extensions zod
```

For Python server extensions:

```sh
uv add openai-mcp-extensions
```

Check [the version snapshot](sources.md#sdk-compatibility-snapshot) and the installed package metadata. The extension Python SDK currently requires the MCP 2 beta interfaces. The TypeScript extension package currently uses the MCP 1.x SDK. Do not assume that their server APIs or MRTR support match.

## Define the tool contract

Write the user goal, required inputs, result fields, authorization rules, side effects, and failure cases for each tool. Use stable IDs from earlier reads for follow-up calls. Describe when the model should use the tool and distinguish similar actions.

Set annotations from behavior:

| Annotation | Set it to `true` when |
| --- | --- |
| `readOnlyHint` | The tool cannot change state |
| `destructiveHint` | The action can have effects that are irreversible or hard to undo |
| `openWorldHint` | The tool accesses public or open-ended external entities |

A private account API is not open-world just because a remote service hosts it. These hints help the host choose its confirmation behavior; handlers still enforce access and input constraints.

`structuredContent` carries model-readable data. `content` provides text and other MCP content. `_meta` can carry UI-only details, but it is not secure storage. Return only what the workflow needs, and never include access tokens in any of these fields.

## TypeScript registration

This excerpt uses an in-memory catalog to show the contract. Replace it with the project's authorized data access. Attach a stdio or HTTP transport after registering all tools and resources.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpenAIExtensions } from "@openai/mcp-extensions/server";
import { z } from "zod";

const server = new McpServer({ name: "item-library", version: "0.1.0" });
const extensions = new OpenAIExtensions(server);
const catalog = [{ id: "item-1", title: "Project plan" }];

server.registerTool(
  "items.list",
  {
    title: "List project items",
    description: "Find project items by title before opening or selecting one.",
    inputSchema: { query: z.string().max(200).optional() },
    outputSchema: {
      items: z.array(z.object({ id: z.string(), title: z.string() })),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ query }) => {
    const search = (query ?? "").toLowerCase();
    const items = catalog.filter((item) => item.title.toLowerCase().includes(search));
    return {
      structuredContent: { items },
      content: [{ type: "text", text: `Found ${items.length} items.` }],
    };
  },
);
```

Keep cross-tool guidance in server `instructions`, such as reading an item before updating it. Place key instructions in the first 512 characters. Do not repeat all tool descriptions there.

For stdio, use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js` and `await server.connect(transport)`. For HTTP, use the installed SDK's Streamable HTTP transport and follow its session lifecycle. Validate incoming host/origin headers as the SDK requires, route requests to `/mcp`, close transports on termination, and avoid global per-user request state.

## Python registration

The current extension SDK uses these interfaces:

```python
from mcp.server.apps import Apps
from mcp.server.mcpserver import MCPServer
from openai_mcp_extensions import OpenAIExtensions

apps = Apps()
extensions = OpenAIExtensions()

# Register app resources, app tools, and extension handlers here.
server = MCPServer("item-library", extensions=[apps, extensions])
```

Register extension handlers before constructing `MCPServer`. Include each extension the server uses. Use Pydantic models and `model_dump(by_alias=True, exclude_none=True)` for metadata with wire-format aliases. Check the SDK's current transport entrypoint rather than copying an older `FastMCP.run()` example.

## Authentication

Read the [authentication guide](https://developers.openai.com/plugins/build/auth) when accessing private data or taking actions for a user. A local package's machine access and a registered server's OAuth connection are different arrangements; use the arrangement the selected host supports.

For registered remote OAuth, implement the MCP authorization contract:

- Publish protected-resource metadata and authorization-server discovery.
- Support authorization code with PKCE `S256`; preserve the `resource` parameter through authorization and token exchange.
- Use CIMD when supported and chosen, or the documented DCR or predefined-client route. Copy the exact redirect URI shown for the connection.
- Verify signature, issuer, audience, expiry, scopes, and resource access on every request.
- Return `401` with a discoverable `WWW-Authenticate` challenge on auth failure.

Advertise tool `securitySchemes` for the actual scopes. Keep credentials in the server's secret store and authenticated request context. A tool argument must not choose an unrelated user's account. Use the request identity for tools, settings, mention search, resources, and event subscriptions.

For CIMD callback details, issuer validation, mTLS, or workspace domain restrictions, follow the current guide. Do not hard-code a guessed OAuth callback. ChatGPT-managed mTLS can identify the client; OAuth still identifies and authorizes the user.

## Multiple accounts

An optional authenticated profile tool helps distinguish connected accounts. Mark it with `_meta["openai/profile"]: true`, accept `{}`, set read-only annotations, and declare an output schema. Return one top-level profile object in `structuredContent`:

```json
{
  "id": "profile-opaque-stable-id",
  "name": "Alex",
  "nickname": "Engineering workspace"
}
```

Use a stored opaque ID that remains stable through token refresh, reconnection, and label changes. Do not use a mutable email address or generate a new ID per login. Optional display fields are `name`, `email`, and `nickname`. Never return another account or a fake fallback identity after auth failure. See [multiple accounts](https://developers.openai.com/plugins/build/auth#support-multiple-accounts).

## Import skills from the server

Use this route only when the author wants skills versioned with the server. [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server#import-skills-from-the-mcp-server) defines OpenAI's static subset of the draft Skills extension.

1. Advertise `io.modelcontextprotocol/skills` under `capabilities.extensions`. The earlier `experimental` location does not work for this importer.
2. Implement paginated `skills/list` and `skills/get` by skill `uri`. Include every parsed frontmatter field and a complete resource manifest.
3. Use `skill://` URIs. The directory holding `SKILL.md` must match its skill name.
4. Give each resource a digest in the form `sha256:<64 lowercase hex characters>`.
5. Implement `resources/read` for each URI, returning exactly one matching content item. Hash text as UTF-8; hash blobs after base64 decoding.

Current import limits:

| Item | Limit |
| --- | --- |
| Unique skills per scan | 5 |
| Catalog pages | 10 |
| Files per skill | 100 |
| `SKILL.md` | 256 KiB |
| Each supporting file | 1 MiB |
| All resources of one skill | 5 MiB |
| Generated ZIP archives in one scan | 8 MiB, including ZIP overhead |

Scan imports a submission-time snapshot. Runtime use does not fetch those files live. Deploy changed resources and scan again for a new release. A failed import can still return the tool list while leaving the draft's skills unchanged.

## Reliability

Return `isError: true` for tool execution failures that the model should explain. Keep protocol errors, auth challenges, and user-facing tool failures distinct. Bound external calls with timeouts and sensible retries. Use idempotency for actions a client may repeat, and keep logs free of credentials and unnecessary user data.

For public infrastructure, verify streaming support through the actual proxy or CDN, persistent settings and account storage, rollback behavior, and asset origins. Report any remaining service configuration rather than pretending a code excerpt deploys the service.
