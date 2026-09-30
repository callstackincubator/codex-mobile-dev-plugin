# Native settings and rich forms

Use the [settings spec](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#structured-settings), [form spec](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#openai-form-elicitation), and the SDK guide for the installed version.

## Structured settings

For simple preferences, the host renders native controls from a schema. The server supplies current values and persists changes. Use a custom settings MCP App only for a task those controls cannot express.

TypeScript registration, with project-specific storage functions:

```ts
import { z } from "zod";

extensions.settings.register({
  fields: {
    units: { schema: z.enum(["mm", "in"]), title: "Measurement units" },
    showGrid: { schema: z.boolean(), title: "Show grid" },
  },
  layout: [{
    kind: "group",
    title: "View",
    items: [
      { kind: "property", property: "units" },
      { kind: "property", property: "showGrid" },
    ],
  }],
  read: (extra) => loadPreferences(extra.authInfo),
  update: (set, extra) => updatePreferences(set, extra.authInfo),
});
```

Use this on the server-side `OpenAIExtensions`. The read handler returns all effective values. The update handler merges a partial patch into that same user's saved values and returns all effective values. Validate the patch and preserve values the host did not send.

The wire capability is `openai/settings` with `readTool` and `updateTool`. MCP `2026-07-28` advertises it through `server/discover` under `capabilities.extensions`. Earlier initialization can use extensions or the documented legacy experimental declaration. Prefer the SDK helper rather than mixing capability locations by hand.

Manual tool requirements:

| Tool | Contract |
| --- | --- |
| Read | Accept `{}`, read-only, declare `outputSchema`, return `structuredContent: { schema, values, layout? }` |
| Update | Accept `{ set: { changedProperty: value } }`, persist changes, return `structuredContent: { values }` |

Supply a current or default value for every schema property, including optional properties. Supported property types are boolean, string with optional enum, number, and integer, with documented bounds. Arrays and nested objects need another UI.

Layout groups can contain property references and tool buttons. Button targets must be same-server tools accepting `{}`. A normal tool shows its result text; an MCP App tool opens a settings modal. Fields missing from the layout appear under "Other settings".

## Python settings

Define a Pydantic preference model, construct `OpenAISettings(schema=Preferences, layout=...)`, register `@settings.read` and `@settings.update` handlers, then include `settings` in `MCPServer(..., extensions=[settings])`.

Use aliases for camelCase wire fields, such as `showGrid`. The checked Python guide adds `settings.advertise_legacy_capability` middleware only for earlier protocol or initialization support. Do not add that middleware to a current server without a reason. Synchronous handlers run in worker threads; async handlers run on the event loop.

## Choose the form flow first

| Connection | Required flow |
| --- | --- |
| OpenAI-registered MCP server | Protocol `2026-07-28` or newer, MRTR form elicitation |
| Direct MCP connection | Legacy or MRTR flow, subject to host capabilities |

The TypeScript `elicitInput` and Python `elicit_input` helpers in the checked extension SDK use the legacy flow. They do not implement MRTR. For a registered server, read the current [MRTR protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) and use a server SDK that supports it. If that support is unavailable, return a clear need for more input or use an authorized UI workflow rather than claiming the legacy form works.

Legacy wire requests use `openai/elicitation/create`, with host support advertised under `capabilities.extensions["openai/elicitation"].form`. An unsupported input type causes the whole form to fail. Check support before offering the form and preserve a useful fallback.

## Direct-connection form example

This TypeScript excerpt applies only to a direct connection using legacy forms:

```ts
const response = await extensions.elicitInput({
  mode: "form",
  message: "Choose an item to inspect",
  requestedSchema: {
    type: "object",
    properties: {
      item: {
        type: "string",
        title: "Item",
        oneOf: [
          {
            const: "item-1",
            title: "Project plan",
            description: "The current project plan.",
            "x-openai-thumbnail": {
              src: "https://your-service.example/previews/item-1.png",
            },
          },
          {
            const: "item-2",
            title: "Release notes",
            "x-openai-thumbnail": {
              src: "https://your-service.example/previews/item-2.png",
            },
          },
        ],
      },
    },
    required: ["item"],
  },
});

if (response.action === "accept") {
  // Validate response.content and authorize its item before using it.
} else {
  // Leave the pending action unchanged on decline or cancellation.
}
```

Use HTTPS or a base64 image data URI for thumbnail `src`. If one option has a thumbnail, all options render in the image layout; provide thumbnails for all options when practical. A returned choice identifies an item but does not authorize a write to it.

## Suggestions and text constraints

Forms support `pattern` on string fields, titled `const` choices with `description`, and free text with `x-openai-suggestions`. Put suggestions on a string property or an array's string `items`:

```json
{
  "type": "array",
  "items": {
    "type": "string",
    "minLength": 1,
    "x-openai-suggestions": [
      { "const": "dimensions", "title": "Dimensions" },
      { "const": "materials", "title": "Materials" }
    ]
  }
}
```

Users can add values beyond the suggestions. Apply the same constraints to both selected and typed values. Do not use this form for passwords, tokens, or other authentication secrets.

## Resource picker

Use `x-openai-input.type: "resource"`. The older `"file"` value is only a compatibility alias.

```json
{
  "type": "array",
  "items": { "type": "string", "format": "uri" },
  "maxItems": 5,
  "x-openai-input": {
    "type": "resource",
    "selection": "explicit",
    "options": [
      {
        "uri": "library://items/item-1",
        "name": "project-plan",
        "title": "Project plan",
        "_meta": {
          "openai/thumbnail": {
            "src": "https://your-service.example/previews/item-1.png"
          },
          "openai/preview": {
            "target": {
              "type": "resource_link",
              "uri": "library://items/item-1",
              "name": "project-plan"
            }
          }
        }
      }
    ],
    "userOptions": { "kind": "file", "accept": [".pdf", "image/*"] }
  },
  "default": ["library://items/item-1"]
}
```

Back the supplied URI with a real resource. Single selection uses a string and returns a URI string; multiple selection uses an array and returns URI strings.

Selection rules:

- `explicit` selects or deselects listed options. If `userOptions` is absent, it offers no upload control.
- `implicit` includes all resources that remain after adding or removing items. It always permits user uploads; omitted `userOptions` means unrestricted files.
- `selection` applies only to arrays. Do not set it on a single-selection string.
- Defaults can use only URIs in `options`. An implicit field must not have a default.
- `userOptions.kind` is `file` or `directory`; `accept` can list filename extensions or MIME types.
- Web forms requested through MCP Apps support explicit selection without user uploads.

A preview target can be a resource link or `{ type: "mcp_app_tool", name, arguments? }` on the originating server. Authorize preview access as well as the final selected resource. Preserve the pending workflow when the user declines, cancels, or returns invalid data.
