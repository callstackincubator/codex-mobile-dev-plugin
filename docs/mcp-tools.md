# MCP tool reference

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

| Tool | Action |
| --- | --- |
| `mobile_open_simulator` | Open the native panel and start the bundled backend |
| `mobile_open_workspace` | Open fullscreen with logs on the left and the simulator on the right |
| `mobile_list_simulators` | Start the bundled backend if needed and list devices |
| `mobile_choose_devices` | Ask through the native inline form for one or several verified task targets |
| `mobile_list_ios_devices` | Discover physical iPhones and iPads with USB/Wi-Fi, pairing state, UDID, and CoreDevice ID |
| `mobile_start_baguette` | Retry or reconnect the bundled backend |
| `mobile_boot_simulator` | Boot one listed device |
| `mobile_shutdown_simulator` | Shut down one listed device |
| `mobile_describe_ui` | Read a booted device's accessibility tree |
| `mobile_screenshot` | Return a booted device's PNG screenshot |
| `mobile_send_input` | Send validated input in device points |
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

When reactivated, the `agent-device` MCP server exposes the pinned runtime's official operations through compact, validated schemas, including `open`, `snapshot`, `press`, `fill`, `type`, `scroll`, `wait`, `find`, `get`, `is`, `close`, and debugging tools. Their input schemas describe each command. The source [control skill](../skills/agent-device/SKILL.md), currently excluded from the package, explains session ordering and links to the version-matched guide.
