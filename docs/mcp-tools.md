# MCP tool reference

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

| Tool | Action |
| --- | --- |
| `mobile_open_simulator` | Open the native panel, optionally targeting a platform, device kind, or discovered device ID |
| `mobile_open_workspace` | Open fullscreen with the same optional device targeting |
| `mobile_list_simulators` | Start the bundled backend if needed and list devices |
| `mobile_choose_devices` | Ask the user to choose task targets in the host's native form; listed only for hosts with one (Codex, Claude Code) |
| `mobile_list_ios_devices` | Discover physical iPhones and iPads with USB/Wi-Fi, pairing state, UDID, and CoreDevice ID |
| `mobile_start_baguette` | Retry or reconnect the bundled backend |
| `mobile_boot_simulator` | Boot one listed device |
| `mobile_shutdown_simulator` | Shut down one listed device |
| `mobile_describe_ui` | Read a booted device's accessibility tree for panel annotations, app-only |
| `mobile_repair_input` | Reclaim input from Device Hub, closing running apps |
| `mobile_stream_session` | Create a panel stream, app-only |
| `mobile_ios_mirror_input` | Send physical iOS panel touches for the current video generation, app-only |
| `mobile_stream_input` | Send a batch of panel input, app-only |
| `mobile_stream_reset` | Recover one iOS panel's MJPEG capture, app-only |
| `mobile_stream_close` | Close a panel stream, app-only |
| `mobile_log_sources` | List connected Android devices and local Metro targets |
| `mobile_logs_session` | Start native and/or Metro log readers |
| `mobile_read_logs` | Read a log batch and source status |
| `mobile_logs_keep_alive` | Keep background collection alive without sending logs (app only) |
| `mobile_logs_close` | Stop a session's log readers |
| `mobile_performance_sources` | Read running apps and foreground identity on the selected iOS or Android device |
| `mobile_cpu_session` | Connect a native process and thread CPU plus memory monitor |
| `mobile_read_cpu` | Read live CPU and memory samples and connection status |
| `mobile_cpu_close` | Stop one CPU and memory monitor while leaving its app running |
| `mobile_record_performance` | Start a timed CPU and memory recording that saves automatically |
| `mobile_read_performance_recording` | Read original samples and a selected interval's summary |
| `mobile_render_performance_recording` | Show an interactive chart card in chat |
| `mobile_compare_performance_recordings` | Overlay 2–6 completed runs in an interactive comparison card |
| `mobile_open_performance_recording` | Open a saved run and selection in the workspace |
| `mobile_finish_performance_recording` | Stop and save a recording early |
| `mobile_list_performance_recordings` | Find recent saved and active runs |
| `mobile_display_fps_session` | Start device-wide Display FPS on Android 12+ or physical iOS 17.4+ |
| `mobile_read_display_fps` | Read FPS intervals and connection status |
| `mobile_read_performance_frames` | Read Android jank/pacing statistics and page through exact display frames |
| `mobile_display_fps_close` | Stop FPS collection and release the tracing connection |

The plugin servers for Codex, Claude and Cursor add the pinned agent-device runtime's commands as `device_*` tools with compact, validated schemas, including `device_open`, `device_snapshot`, `device_screenshot`, `device_press`, `device_fill`, `device_type`, `device_scroll`, `device_wait`, `device_find`, `device_get`, `device_is`, `device_close`, and debugging tools. The agent reads screens and sends input with them; `device_screenshot` also returns the saved image. Their annotations let hosts run reads, device input and app control without asking, as with the panel's tools, while installs, scripts, app-defined events, file outputs, the clipboard and development servers still ask (see [Architecture](architecture.md#runtime)). Their input schemas describe each command; `logs` and `perf` are left out for Mobile Dev's own tools. The agent-device skill explains the control loop and ships the runtime's own workflow guide.


## TraceSift annotations

Analysis writes compact results and replaces the latest reference for the input
profile. Remember writes/replaces the reference for a host view. Both declare
`readOnlyHint: false` and `destructiveHint: true` because a previous association
can be overwritten, even though the input profile is not edited.

Explore, Explore payload, and investigation handoff declare `readOnlyHint: false`
and `destructiveHint: false`: they can start a local background service, and
browser Explore also launches the explorer. The file picker shares those hints:
it opens the host's own dialog and waits for a person, but writes nothing. The two
restore tools only read local files and remain read-only. Reading the chosen
project is read-only; choosing one declares `destructiveHint: true`, because it
replaces the previously saved folder. All ten use `openWorldHint: false`;
operations are confined to local files, the host's own dialogs, and the
authenticated loopback TraceSift service.

The two pickers exist because the TraceSift tool runs in a panel frame, where a
dropped file carries no path and the analyzer reads profiles off disk. Both are
app-only: the model never calls them. The chosen profile path reaches
`mobile_analyze_profile` from the panel, and the chosen project folder is the
source tree an investigation lands in — a profile names frames, not files, so
Investigate stays disabled until one is chosen, and the folder is named in the
hand-off the panel sends to the chat.
