# File viewers and editors

Use the [file-entrypoint specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#file-extension-entrypoint) and [SDK resource examples](https://github.com/openai/mcp-extensions/blob/main/typescript/README.md#file-extension-handlers). File entrypoints, local opening, and file resources currently require desktop support.

## Register a dedicated file tool

Keep it separate from global or thread tools unless its schema accepts each documented launch shape. Use dot-prefixed file extensions rather than MIME types in the entrypoint declaration:

```ts
import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";

registerAppTool(server, "notes.open_file", {
  title: "Notes file editor",
  inputSchema: {
    file: z.object({
      name: z.string().min(1),
      resourceUri: z.string().min(1),
    }),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: {
    ui: { resourceUri: "ui://notes/v1/editor.html", visibility: ["app"] },
    "openai/ui": {
      entrypoints: [{ type: "file", extensions: [".notes", ".txt"] }],
    },
  },
}, async ({ file }) => ({
  content: [],
  structuredContent: { fileName: file.name },
}));
```

Register the referenced HTML resource too. Opening the viewer is read-only; a separate save action can change the resource. The host passes the same `file` arguments through `ui/notifications/tool-input` to the app.

## Read through the host

`file.resourceUri` is opaque. It does not reveal a filesystem path. The host intercepts resource calls for the opened file.

This excerpt assumes project functions `showUnsupportedHost`, `renderText`, and `showError`:

```ts
import { OpenAIFileEntrypointInputSchema } from "@openai/mcp-extensions/app";

app.addEventListener("toolinput", async ({ arguments: args }) => {
  const parsed = OpenAIFileEntrypointInputSchema.safeParse(args);
  if (!parsed.success) return;
  const resources = extensions.resources;
  if (!resources) return showUnsupportedHost();

  try {
    const result = await resources.read({
      uri: parsed.data.file.resourceUri,
      representation: "text",
    });
    const content = result.contents[0];
    if (!content || !("text" in content)) {
      return showError("The host did not return text.");
    }
    renderText(content.text, content.openaiMetadata);
  } catch {
    showError("Unable to read the opened file.");
  }
});

// Register the listener before this call.
await app.connect();
```

Use `representation: "blob"` for binary files and decode the base64 content. If omitting a preference, handle either representation. Apply size and format checks before parsing, and display errors without losing the user's existing draft.

## Subscribe and clean up

Install a handler before subscribing so an early update cannot be missed:

```ts
const resources = extensions.resources;
const removeHandler = resources?.addUpdateHandler(async ({ params }) => {
  if (params.uri === openedUri) await reloadOpenedFile();
});
await resources?.subscribe({ uri: openedUri });

// On close or when replacing the opened resource:
removeHandler?.();
await resources?.unsubscribe({ uri: openedUri });
```

Use the project UI's lifecycle for cleanup. When several reads overlap, discard results for a resource that is no longer open. For an editor with unsaved changes, an external update needs a visible reload or merge choice; it must not erase the draft.

## Save with a version check

The SDK exposes content `_meta["openai/resource"]` as `openaiMetadata`. It contains optional `writable` and `etag`.

```ts
const metadata = lastReadContent.openaiMetadata;
if (metadata?.writable !== true) {
  showError("This file is read-only in the current host.");
} else {
  const result = await extensions.resources?.write(openedUri, {
    text: draftText,
    ...(metadata.etag == null ? {} : { ifMatch: metadata.etag }),
  });
  if (result?.outcome === "saved") {
    rememberSavedVersion(result.etag);
  } else if (result?.outcome === "conflict") {
    showConflictAndPreserveDraft(result.etag);
  } else if (result?.outcome === "too-large") {
    showError(`This host allows at most ${result.maxBytes} bytes.`);
  }
}
```

The project supplies the variables and UI functions above. Keep read metadata from the same resource and version as the draft. The write method accepts exactly one replacement representation, `text` or base64 `blob`. Use the latest ETag when available. Do not retry a conflict without checking new contents and resolving it with the user.

The wire method is `openai/resources/write`. It can write only the host URI provided by the file entrypoint, and only after the read result advertises `writable: true`. A tool returning a URI does not grant write access to that URI.

## Related files and large-file processing

For a tool call originating in a file-entrypoint app, the host can add `_meta["openai/resource"]["path"]` for the server. In TypeScript use `getResourcePath(extra._meta)` from `/server`; Python uses `get_resource_path(context.request_context.meta)`.

Use this path only in a server that can access the execution host's filesystem. A remote service does not gain filesystem access merely by receiving a path string. Keep ordinary app reads on the host resource API.

For a dedicated related-file tool:

1. Read the opened path from request metadata, not a model-supplied absolute path.
2. Choose the intended allowed directory and resolve it with `realpath`.
3. Resolve the requested relative path, reject absolute escapes and traversal, then resolve symlinks and check containment again.
4. Apply file size, format, and action permissions. Return the required contents or a safe error.

Do not expose raw paths to an untrusted app. A path in host metadata is context for the operation, not permission to read the rest of the machine.

## Open a local file

When the server has provided a valid absolute path on the execution host and the app has the capability:

```ts
await extensions.files?.open(absolutePath);
```

This asks the host to open that file. It does not upload a file to the server, create one, or grant broader file access. Hide or disable the action when the capability is absent.
