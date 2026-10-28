---
name: agent-device
description: Drive apps on a local iOS simulator or Android device with Mobile Dev's device_* tools, the bundled agent-device runtime's commands. Use for opening apps, accessibility snapshots and refs, taps, text entry, scrolling, waits, and checking that the app reached the requested state.
---

# agent-device

Mobile Dev bundles agent-device 0.20.9 and serves each of its commands as a `device_<command>` tool: `device_open` is its `open` command, and so on. No global CLI install, npx download, or separate server is needed. Follow the Mobile Dev skill to choose the device and to build, install, and launch the app; this skill covers driving it.

Read [the workflow guide](references/workflow.md) before the first task. It is this agent-device version's own `help workflow`, written for its CLI. With the tools:

- Pass each command's options as the JSON fields in its tool's input schema, not as flags: `snapshot -i` is `device_snapshot` with `interactiveOnly: true`, and `--settle` is `settle: true`.
- Commands that act on an element take a `target` object instead of a positional ref or selector: `{ "kind": "ref", "ref": "@e12" }` or `{ "kind": "selector", "selector": "label=\"Search\"" }`.
- Skip the guide's shell advice, such as chaining commands with `&&`. Its `help <topic>` pointers are not available through the tools; each tool's description gives that command's contract.
- `logs` and `perf` are not served; use Mobile Dev's log and performance tools.

1. Use the chosen device's UDID (iOS) or running serial (Android) from Mobile Dev's tools or panel. Call `device_open` with the app, `platform`, `udid` or `serial`, a short `session` name, and `foreground: true`. If the app ID is unknown, find it with `mobile_list_apps` or `device_apps` first; do not invent one or boot another device.
2. Read the refs `device_open` returns, or call `device_snapshot` with `interactiveOnly: true`. Use actual refs from the latest result, or a known selector; prefer them to coordinates.
3. Call `device_press`, `device_fill`, or `device_scroll` with `settle: true`, and continue from the settled diff. `device_fill` replaces text; `device_type` appends to the focused field and has no settle option. Run stateful commands in order within one session.
4. Verify the requested result with a named expectation through `device_wait`, `device_is`, `device_get`, or `device_find`. Give `device_find` a read-only `action` such as `exists` or `getText`; without one it taps the match. A screenshot or snapshot alone is not verification, and an accepted input does not prove the app changed. `device_screenshot` returns the image when you need to look at the screen.
5. Call `device_close` when finished. Leave `shutdown` unset to keep the device running. Closing can close the active app; skip it if the user wants that app left open.

A selector that matches several elements fails with `AMBIGUOUS_MATCH` and lists the candidates: retry with one of their refs or a narrower selector.

Pass device selection to `device_open` once. Later commands take the same `session` and no `platform`, `udid`, `serial`, or `device`; the session holds the device. Discovery, installation, and standalone script tools keep their selection fields. Batch steps inherit the outer session and follow each command's own schema. Follow later user device selections by opening a session on the new device.

Mobile Dev manages state paths, runner configuration, and output format, so tool inputs omit them. Each server has its own temporary state directory; `device_session` with `action: "state-dir"` returns it, and its logs and artifacts stay there. Another agent-device daemon can own a simulator's runner; do not force-release a live owner's claim. End that task's session or choose another device. The server stops its daemon and releases its runner leases when it shuts down.

The first iOS interaction builds the bundled Apple runner with the local Xcode and caches it under `~/.agent-device/apple-runner`, which takes about a minute. Android uses the installed SDK's adb. For Android, pass `platform: "android"` and `serial`, never `udid`; a stopped AVD gets its running serial after booting.
