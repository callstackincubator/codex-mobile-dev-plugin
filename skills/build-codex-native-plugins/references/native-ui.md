# Native UI and composer features

Use the [extension spec](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md), [TypeScript guide](https://github.com/openai/mcp-extensions/blob/main/typescript/README.md), and [Add UI](https://developers.openai.com/plugins/build/chatgpt-ui). Browser APIs use the TypeScript app SDK even when Python serves the MCP endpoint.

Prefer the shared `App` APIs for new MCP Apps. Older `window.openai` widget APIs remain a ChatGPT compatibility layer. Use that layer only for a documented need, and check the actual host before depending on it.

## Register the app resource and entrypoint

Register a real built HTML resource. Bundle or inline its JavaScript and CSS, including dependencies. This excerpt assumes `server` already exists and `app.html` is the production UI output:

```ts
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type {
  OpenAIUiToolMetadata,
  OpenAIUiResourceMetadata,
} from "@openai/mcp-extensions/server";

const APP_URI = "ui://item-library/v1/library.html";
const appHtml = readFileSync(new URL("./app.html", import.meta.url), "utf8");

registerAppResource(server, "item-library", APP_URI, {}, async () => ({
  contents: [{
    uri: APP_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: appHtml,
    _meta: {
      ui: {
        csp: { connectDomains: [], resourceDomains: [] },
      },
      "openai/ui": {
        preferredDisplayMode: "fullscreen",
        availableDisplayModes: ["inline", "fullscreen"],
      } satisfies OpenAIUiResourceMetadata,
    },
  }],
}));

registerAppTool(server, "items.library", {
  title: "Project item library",
  description: "Open the project item library to browse available items.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: {
    ui: { resourceUri: APP_URI, visibility: ["app", "model"] },
    "openai/ui": {
      entrypoints: [{ type: "global" }, { type: "thread" }],
    } satisfies OpenAIUiToolMetadata,
  },
}, async () => ({
  content: [{ type: "text", text: "Opened the project item library." }],
  structuredContent: { items: [] },
}));
```

Populate the opening result with the real authorized initial data. Do not make a second opening call just to render the first screen.

`_meta.ui.visibility` chooses app or model tool visibility for ordinary use. The host ignores that distinction when opening a native entrypoint. Use app-only tools when model invocation would have no useful role.

## Entrypoint choices

| Type | Purpose | Initial arguments |
| --- | --- | --- |
| `global` | Sidebar app | `{}` |
| `thread` | Panel in one conversation | `{}` |
| `file` | Viewer or editor for dot-prefixed extensions | `{ file: { name, resourceUri } }` |
| `settings` | Custom settings UI | Match the supported settings tool contract, normally `{}` |

Give thread tools distinct titles that describe their view. Each thread gets its own app instance. Entrypoints use the host's fullscreen mode, including a panel beside a conversation.

The checked SDK also supports a global `quickAction` with `title`, `icons`, and a same-server tool target:

```ts
{
  type: "global",
  quickAction: {
    title: "Create item",
    icons: [{ src: "https://your-service.example/assets/plus.svg" }],
    target: { type: "tool", name: "items.create", arguments: {} },
  },
}
```

Use only a real target that accepts those arguments and applies its normal action permissions. A custom settings entrypoint can provide `searchTerms`. Prefer [structured settings](settings-and-forms.md) for simple preference controls.

## App connection and host styles

This excerpt calls project-specific `renderLibrary` and `showError` functions. Supply those functions in the app.

```ts
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import "@openai/mcp-extensions/app/styles.css";

const app = new App({ name: "item-library-ui", version: "0.1.0" });
const extensions = new OpenAIExtensions(app);

function applyHostContext(context: ReturnType<App["getHostContext"]>) {
  if (context?.theme != null) applyDocumentTheme(context.theme);
  if (context?.styles?.variables != null) {
    applyHostStyleVariables(context.styles.variables);
  }
}

app.ontoolresult = (result) => {
  if (result.isError) showError(result.content);
  else renderLibrary(result.structuredContent);
};
app.addEventListener("hostcontextchanged", applyHostContext);
await app.connect();
applyHostContext(app.getHostContext());
```

Register tool-input listeners before connecting for file handlers. Apply initial host context after connection, since initial context does not necessarily emit a change event. Optional `message`, `modelContext`, `files`, and `resources` APIs become usable only after negotiation and can stay absent.

The provided stylesheet includes `card`, `form-label`, `form-control`, `btn`, and `btn-primary`. Use `cursor-interaction` on controls to follow the desktop cursor preference. Keep app layout CSS separate from host control styles. Test layouts without relying on hover or fixed desktop sizes when those targets are in scope.

## Display modes, CSP, and state

Use `inline` or `fullscreen` for current ChatGPT targets. `preferredDisplayMode` is a hint. Keep the supported modes in resource metadata consistent with the app's declared modes. Do not advertise `pip` solely because an SDK type accepts it.

Under resource `_meta.ui.csp`, declare exact `connectDomains` for HTTP APIs and `resourceDomains` for external assets. Use `frameDomains` only for an approved embedded experience. Empty lists fit a fully bundled app whose operations go through MCP. Follow the host's domain rules when embedding another page; do not use wildcard lists to fix a load failure.

Business data belongs to the service or MCP server. Temporary selection and view state belong to an app instance. Durable preferences need server storage. Return updated authoritative data after writes. Publish a new UI resource URI for a breaking bundle change and update each tool that uses it.

## Deep links

Use a global entrypoint and a validated app-relative route. The route must begin with `/` and have no fragment. Encode the full route, including its query, as the `path` value. Encode plugin and tool IDs as path components.

```ts
const route = "/items/item-1?tab=details";
const link = `codex://plugins/${encodeURIComponent(pluginId)}@${encodeURIComponent(marketplace)}`
  + `/app/${encodeURIComponent(toolName)}?path=${encodeURIComponent(route)}`;
```

For directly published plugins, omit `@marketplace`. Desktop uses `codex`, supported mobile uses `chatgpt`, and web uses `https://chatgpt.com/plugins/<plugin-id>/app/<tool-name>?path=...`. Use a real installed or published identity.

Read `extensions.deepLink.getCurrent()` after connection and on `hostcontextchanged`. It returns the app-relative `url` or `undefined`. Validate and apply the route without taking it as permission to access a record.

## Share context with the model

Use `extensions.modelContext.update()` for the current selection or view that should accompany the user's next prompt:

```ts
const contextApi = extensions.modelContext;
if (contextApi) {
  await contextApi.update({
    content: [{
      type: "text",
      text: "Selected project item: item-1, Project plan.",
      _meta: { "openai/title": "Project plan" },
    }],
    structuredContent: { selectedItemIds: ["item-1"] },
  });
}
```

Each update replaces that app instance's prior context. Read `getCurrent()` after connection and on host-context changes. A `null` context means the host cleared it; `undefined` means no current state is available. Reflect removals in the UI instead of reattaching them from stale state.

Text, images, resource links, and embedded resources work; audio does not. Add `openai/title` for labels and `openai/thumbnail` for a text attachment image. Put background text under `annotations.audience: ["assistant"]` when it should not be a visible attachment. The model still receives it. Content `_meta` is excluded from model input, so include the actual fact in text or structured data.

## Send a user message

Use the app's message API for a user-triggered action such as "Ask about selection":

```ts
await extensions.message?.send({
  role: "user",
  content: [{ type: "text", text: "Compare the selected project items." }],
});
```

The default targets the active conversation and sends immediately. The extension can target a new conversation on supported hosts with `_meta["openai/message"]: { target: "new" }`. The checked schema allows only `send: true`; do not invent a draft-only `send: false` mode. Mobile supports only the default active send behavior. Message attachment removal does not notify the app, so do not show message attachments as persistent app selections.

## Composer mentions

Register mention search with the server extension. `searchItemsForAccount` is the project's authorized search, and each returned URI must have a real resource retrieval path:

```ts
extensions.mentions.setHandler(async ({ query }, extra) => {
  const items = await searchItemsForAccount(query, extra.authInfo);
  return {
    items: items.map((item) => ({
      type: "resource_link" as const,
      uri: item.resourceUri,
      name: item.id,
      title: item.title,
    })),
  };
});
```

The helper advertises `_meta["openai/extensions"]["mentions/search"]: {}` and app visibility. For a manual handler, expose `{ query: string }` and return `structuredContent: { items: ResourceLink[] }`. Handle an empty query, cap results, enforce account access, and keep typeahead search fast. Check the installed SDK if you need its extra mention-item variants. Composer mentions currently require the desktop app.
