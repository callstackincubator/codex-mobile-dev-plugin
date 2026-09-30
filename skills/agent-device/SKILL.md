---
name: agent-device
description: Control a local iOS simulator with Mobile Dev's bundled agent-device MCP tools. Use for opening apps, accessibility snapshots, element refs, taps, text entry, scrolling, waits, and app debugging.
---

# agent-device

This plugin includes agent-device 0.20.9, its official MCP server, dependencies, and Apple runner source. Use the plugin's `agent-device` MCP tools. No global CLI install, npx download, or separate server is needed. Baguette keeps the simulator stream in the Mobile Dev panel.

Read [the bundled workflow guide](references/workflow.md) before the first task. It comes from this runtime's `help workflow`. Its CLI command names match the MCP tool names; use each tool's input schema for JSON fields.

1. Use the UDID selected in Mobile Dev. If the task names an app, call `open` with that app, `platform: "ios"`, the UDID, a short session name, and `foreground: true`. Reuse that session for later calls. If the app is unknown, call `apps` for the chosen UDID and discover it first. Do not invent an app id or boot another device.
2. Read the interactive refs returned by `open`, or call `snapshot` with `interactiveOnly: true`. `press` and `fill` take a `target` object. Use `{ "kind": "ref", "ref": "@e12" }` with an actual ref from the latest result, or `{ "kind": "selector", "selector": "label=\"Search\"" }` with a known selector. Refs vary on each screen. Prefer refs or selectors over coordinates.
3. Call `press`, `fill`, or `scroll` with `settle: true`. Continue from the returned diff and refs. Refresh the snapshot when the result lacks the next target. `fill` replaces text; `type` appends to the focused field and has no settle flag. Run stateful commands in order within one session.
4. Verify the requested result with a named expectation through `wait`, `is`, `get`, or `find`. An accepted input does not prove that the app changed.
5. Use `close` when finished. Leave `shutdown` unset to keep the simulator running. Closing can close the active app; omit this step if the user wants that app left open. The plugin cleans its daemon and runner leases when the MCP connection ends.

Keep `stateDir`, remote daemon fields, and runner paths unset. The plugin gives each MCP process its own local state directory and uses the packaged runtime. Session names separate tasks within that process. Host device claims still protect a simulator owned by another agent-device daemon. Do not force-release a live owner's claim. End that task's session or choose another device.

The first XCTest interaction builds the bundled Apple runner with the host's Xcode and caches it under `~/.agent-device/apple-runner`. The source ships in the plugin; it needs no download. Logs and artifacts stay in the temporary state directory returned by `session` with `action: "state-dir"`.

Do not run type checks, lint, Biome, visual checks, or React Doctor unless the user asks. Before starting an app dev server, check for an existing server from that project. Follow the app project's own build and launch tools. Use Mobile Dev's explicit input repair only for blocked Device Hub input, since it closes running simulator apps.
