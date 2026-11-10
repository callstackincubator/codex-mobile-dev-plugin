---
name: mobile-dev
description: Use when building, running, changing, or debugging local iOS, Android, Expo, React Native, or SwiftUI apps in Antigravity. Renders Mobile Dev's device panel in the Antigravity Auxiliary Pane beside the chat, controls devices with Mobile Dev's device_* tools, reads native and Metro logs, and records CPU, memory, and FPS into interactive charts in chat. Skip web-only apps and tasks limited to planning, docs, or code review.
---

# Mobile Dev

Mobile Dev shows the user's simulator, emulator, or physical iPhone in the Antigravity Auxiliary Pane (`[Mobile Dev](sidecar://mobile-dev/device-panel/)`) beside the chat, and gives you the tools to control apps on it, read its logs, inspect app architecture, and record its performance.

Before calling a Mobile Dev tool that is not yet in your tool list, load it through your tool-search tool if your session uses deferred tools. If none of the `mobile_*` or `device_*` tools exist at all, read `references/missing-tools.md` to diagnose the plugin's Node.js startup.

## Read the panel's context first

The Auxiliary Pane does not push its selection into the chat on its own. Call `mobile_read_panel_context` before device work and whenever the user refers to "this screen", "these logs", a screenshot, or a device they selected:

- It returns the active and visible device IDs from every open Mobile Dev panel, and any logs, screenshots, and screen notes the user clicked **Add to chat** on.
- Pass the active device ID to your `mobile_*` and `device_*` calls so you act on the device the user is looking at.

## Show the device panel when the user wants to see the app

When the user asks to open a simulator, emulator, or device, run the app, or see a UI change:

1. Call `mobile_open_simulator` with the platform (`ios` or `android`), `mobile_open_workspace` when both platforms or a workspace tool (`logs`, `performance`, `storage`, `app-intel`, `tracesift`) is wanted, or `mobile_open_app_intel` to visualize the React Native screen/dependency graph. Pass `deviceId` when one is already known.
2. In Antigravity, the Mobile Dev Auxiliary Pane updates automatically to the requested view and target. Include the clickable pill `[Mobile Dev](sidecar://mobile-dev/device-panel/)` in your reply so the user can toggle the Auxiliary Pane with one click. Never open an external Chrome browser or launch a browser subagent for the loopback URL.

Never open the simulator backend's `baseUrl` (`127.0.0.1:46672`) or the `ui://mobile-dev/app.html` resource URI in a browser; neither is a standalone page.

## App Intelligence

App Intelligence statically discovers Expo Router and React Navigation screens and combines their source dependencies for iOS and Android; it does not require App Flow or a running device. When the user asks to see the app map, call `mobile_open_app_intel` and include `[Mobile Dev](sidecar://mobile-dev/device-panel/)`. Generate or refresh with `mobile_generate_app_intel`, passing `projectPath` when no project is remembered. For a screen or file dependency question, call `mobile_app_intel` with `operation: "screen"` or `"file"`, start with depth 1, and paginate only when `nextOffset` is present.

## Drive the app and verify UI changes

Use the `agent-device` skill for `device_*` commands: `device_open`, `device_snapshot`, `device_click`, `device_fill`, `device_scroll`, `device_wait`, `device_screenshot`, and the rest. Use `mobile_install_app`, `mobile_launch_app`, `mobile_stop_app`, `mobile_open_url`, `mobile_set_app_permission`, `mobile_set_app_language`, and `mobile_send_push` for app lifecycle and system state.

After a code change the user can see on screen, check it on the device and leave the app on the affected screen so they can see it in the panel.

## Logs, storage, and performance

- **Logs:** start `mobile_logs_session` with sources (`ios_Sim`, `android`, `ios_physical`, or `metro`), read with `mobile_read_logs`, and close with `mobile_logs_close` when done.
- **App storage:** inspect UserDefaults, SharedPreferences, AsyncStorage, MMKV, Keychain, and SQLite with `mobile_app_storage`, `mobile_app_storage_table`, and `mobile_app_storage_file`.
- **Performance:** record CPU, memory, and FPS with `mobile_record_performance`, finish with `mobile_finish_performance_recording`, and render or compare in chat with `mobile_render_performance_recording` and `mobile_compare_performance_recordings`. The chart renders in the chat; the device panel stays in the Auxiliary Pane.
