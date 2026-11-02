---
name: build-codex-native-plugins
description: "Create, extend, package, and troubleshoot Codex and ChatGPT plugins using OpenAI MCP Extensions. Use for native sidebar apps, conversation panels, file viewers or editors, settings, composer mentions, rich forms, onboarding, and plugin marketplaces. Also covers MCP tools, authentication, bundled skills, events, and public submission."
---

# Build Codex native plugins

Build an installable plugin whose tools and native UI complete the user's stated workflow. Use standard MCP and MCP Apps for the shared protocol, then add OpenAI MCP Extensions for the native features the workflow needs.

Explicit user instructions take precedence over this skill. Keep the user's chosen language, framework, package manager, and distribution route unless a documented limit requires a change.

## Start with the actual host and workflow

Inspect the project, its instructions, existing manifest, dependency versions, and build output. Determine:

- The user goal, inputs, expected result, and actions that change data.
- The target host, such as Codex desktop, Codex CLI, ChatGPT Work web, or mobile.
- Whether the plugin uses packaged skills, local MCP tools, a hosted MCP server, or a mix.
- Which native features the user needs and how the workflow should work without them.
- Whether the task ends at local use, team distribution, a reviewable ZIP, or authorized publication.

Infer routine choices from the project. Ask only for missing facts that affect the design. A universal directory listing does not imply that every native feature works on every client.

## Read the relevant reference

| Task | Reference |
| --- | --- |
| Manifest, bundled skills, local or remote MCP configuration, compatibility, marketplace | [Packaging](references/packaging.md) |
| Tool contracts, TypeScript or Python SDK setup, OAuth, account identity, server-imported skills | [MCP servers and authentication](references/mcp-server.md) |
| Sidebar, thread or custom settings app, display modes, deep links, model context, messages, mentions, host styles | [Native UI](references/native-ui.md) |
| File handler, host resource reads and writes, subscriptions, related files | [Files and resources](references/files.md) |
| Native settings controls, image choices, suggestions, resource pickers, MRTR limits | [Settings and forms](references/settings-and-forms.md) |
| Event subscriptions and webhook delivery | [Events](references/events.md) |
| Local testing, host support, errors, review ZIP, submission, release updates | [Testing and release](references/testing-and-release.md) |
| Current official links, SDK version snapshot, source conflicts | [Sources](references/sources.md) |

Read only the references that apply. Examples show registration and API use; connect them to the project's storage, authorization, UI, and transport. Do not leave example domains, fake IDs, or missing application functions in a finished plugin.

## Keep package and protocol roles clear

- A plugin packages skills, MCP configuration, and optional resources. A skill supplies workflow instructions. An MCP server supplies tools, live data, authorization, and optional UI resources.
- For a new portable package, use root `plugin.json`, root `mcp.json` when needed, and `skills/`. Put OpenAI settings under `extensions.com.openai`.
- Preserve a working `.codex-plugin/plugin.json` compatibility package when the user asks for an edit. Migrate only when the task calls for it. Portable and compatibility MCP files have different formats.
- Register UI HTML as an MCP resource and link it from a tool through `_meta.ui.resourceUri`. Native entrypoints belong in that tool's `_meta["openai/ui"].entrypoints`.
- Display-mode hints belong on the UI resource content item's `_meta["openai/ui"]`. Put shared UI security and domain settings in `_meta.ui`.
- Import `OpenAIExtensions` from `/server` in server code and `/app` in browser code. They are distinct classes.
- Check negotiated app capabilities after `app.connect()`. Optional extension APIs can remain absent on an unsupported host.

## Build the workflow

1. Define tools around user actions. Specify inputs, structured results, account scope, side effects, and errors. Keep read and write actions distinct when their permissions differ.
2. Implement the server and make its model-readable results useful before adding UI. A UI failure should not hide the tool's outcome.
3. Register the UI resource and the entrypoint tools. Global and thread entrypoints must accept `{}`. Give file handlers their documented `file` input.
4. In the app, register initial tool input, result, and host-context handlers before connecting. Render the initial result without repeating the opening tool call.
5. Add only the needed extensions. Preserve account isolation, scope checks, file version checks, and form cancellation behavior.
6. Bundle runtime code, UI HTML, CSS, and assets. Check paths from the installed plugin root, including in a copied package that cannot use the development checkout.
7. Package the skill instructions and any setup skill. Connect onboarding with `extensions.com.openai.onboardingSkill` when the workflow needs it.
8. Add or update the intended marketplace without replacing its other entries. Refresh and install through the host's supported flow.
9. Run permitted checks for the changed behavior. Test the server contract and installed workflow separately when the environment allows it. Report anything the host or account prevents you from testing.

Before starting a development server, check whether this project already has one and reuse it. Follow user and repository rules for type checks, lint, visual checks, and other test commands. A command named `build` may run prohibited checks; inspect its script first.

## Rules that prevent common failures

- Treat file-entrypoint URIs as opaque. The host handles their resource operations. Never derive a local path by parsing the URI.
- Save a host resource only when its read metadata says `writable: true`. Use the latest ETag as `ifMatch` and handle conflicts without silently replacing the user's edits.
- Persist business data and settings on the server. Keep temporary UI state in the app. Synchronize model context with host changes so a removed attachment stays removed.
- Registered remote MCP servers require protocol `2026-07-28` or newer and MRTR for form elicitation. The SDK's legacy `elicitInput` and `elicit_input` helpers do not implement MRTR.
- Keep credentials out of manifests, UI data, tool results, and review ZIPs. Enforce access in handlers; annotations and skill instructions do not grant access.
- Hooks require runtime scripts and user trust. Public ZIP submission currently rejects hooks and registered app references. A valid local package may need a separate public package.
- Confirm current platform support, package schemas, SDK exports, and submission rules from the linked sources when the task relies on them. State a source conflict instead of guessing an API.

## Finish with a usable result

Provide the plugin or skill paths, supported workflows, needed setup, runtime dependencies, and how to install or refresh it. State which checks ran and which remain unverified. For a release task, prepare the actual package and review materials before any approval the publication step needs.

Keep a local build, directory installation, workspace sharing, and public publication distinct in the report. Do not claim a plugin is installed, trusted, connected, tested in a host, submitted, or published without evidence.
