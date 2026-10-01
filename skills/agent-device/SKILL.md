---
name: agent-device
description: Control a local iOS simulator or Android device with Mobile Dev's bundled agent-device MCP tools. Use for opening apps, accessibility snapshots, element refs, taps, text entry, scrolling, waits, and app debugging.
---

# agent-device

This plugin includes agent-device 0.20.9, its official MCP server, dependencies, and Apple runner source. The plugin exposes its operations through compact MCP schemas. Use the plugin's `agent-device` MCP tools. No global CLI install, npx download, or separate server is needed. Baguette keeps the iOS stream and serve-emu keeps the Android stream in the Mobile Dev panel.

For app development and interactive app control, follow [the Mobile Dev skill](../mobile-dev/SKILL.md) for opening the panel and choosing a device. Open the panel beside the chat by default, or reuse it if already open. Keep an explicit tool-only workflow or a host without panels tool-only. Build, install, and launch with the app project's own tools on the same device shown in the panel.

Read [the bundled workflow guide](references/workflow.md) before the first task. It comes from this runtime's `help workflow`. Its CLI command names match the MCP tool names; use each tool's input schema for JSON fields.

1. Use the chosen device's UDID from Mobile Dev or its device-list tools. If the task names an app, call `open` with that app, `platform: "ios"`, the UDID, a short session name, and `foreground: true`. Reuse that session for later calls. If the app is unknown, call `apps` for the chosen UDID and discover it first. Do not invent an app id or boot another device. Follow later user device selections and refresh the session's refs when changing devices.
2. Read the interactive refs returned by `open`, or call `snapshot` with `interactiveOnly: true`. `press` and `fill` take a `target` object. Use `{ "kind": "ref", "ref": "@e12" }` with an actual ref from the latest result, or `{ "kind": "selector", "selector": "label=\"Search\"" }` with a known selector. Refs vary on each screen. Prefer refs or selectors over coordinates.
3. Call `press`, `fill`, or `scroll` with `settle: true`. Continue from the returned diff and refs. Refresh the snapshot when the result lacks the next target. `fill` replaces text; `type` appends to the focused field and has no settle flag. Run stateful commands in order within one session.
4. Verify the requested result with a named expectation through `wait`, `is`, `get`, or `find`. An accepted input does not prove that the app changed.
5. Use `close` when finished. Leave `shutdown` unset to keep the simulator running. Closing can close the active app; omit this step if the user wants that app left open. The plugin cleans its daemon and runner leases when the MCP connection ends.

Pass device selection to `open` once. Later interactions require only the same named `session` and command arguments; they do not accept `platform`, `udid`, `serial` or `device` overrides. Device discovery, installation and standalone script tools retain their selection fields. The upstream session is the authority for the device binding. Batch steps inherit the outer session and obey each matching tool's compact input schema.

Plugin configuration is absent from tool inputs: state paths, remote daemon fields, runner paths and output-format options are managed by the plugin. Each MCP process has its own local state directory and packaged runtime. Session names separate tasks within that process. Host device claims still protect a simulator owned by another agent-device daemon. Do not force-release a live owner's claim. End that task's session or choose another device.

The first XCTest interaction builds the bundled Apple runner with the host's Xcode and caches it under `~/.agent-device/apple-runner`. The source ships in the plugin; it needs no download. Logs and artifacts stay in the temporary state directory returned by `session` with `action: "state-dir"`.

Do not run type checks, lint, Biome, visual checks, or React Doctor unless the user asks. Before starting an app dev server, check for an existing server from that project. Follow the app project's own build and launch tools. Use Mobile Dev's explicit input repair only for blocked Device Hub input, since it closes running simulator apps.

For Android, use the selected running serial with `platform: "android"` and `serial`, rather than `udid`. Call `mobile_list_android_devices` to resolve a stopped AVD to its running serial after boot. Keep the same named agent-device session for later calls. Android uses the installed SDK's adb and does not need an XCTest runner. The panel's Android stream runs through the bundled serve-emu backend.
