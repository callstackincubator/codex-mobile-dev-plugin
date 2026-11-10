---
name: mobile-dev-setup
description: Set up Mobile Dev in Claude, check its local iOS and Android tools, and recover missing plugin tools.
---

# Set up Mobile Dev in Claude

Resolve Mobile Dev's tools through tool discovery before device work. If
`mobile_open_simulator` or the device-list tools are missing, tell the user:
"Mobile Dev could not start. I'll check its setup." Follow
[missing-tools recovery](references/missing-tools.md) and explain the actual failure.
Source edits and compilation can continue without device tools.

The installed plugin includes the server, MCP Apps panel, agent-device, and native
log and performance helpers. The first device-panel open downloads the pinned
Baguette, serve-emu, physical iOS mirroring, and resource-saving helpers. The server
checks the archive's size and SHA-256 and caches it across sessions. Do not install
separate backends or ask the user to start them. No account or hosted service is
needed.

1. Check for an Apple Silicon Mac, Node.js 22.19 or later, and the toolchain for the
   requested platform. iOS simulators need Xcode 26 or later. Physical iPhone logs
   need Xcode 27 or later. Android needs SDK platform-tools and emulator, plus an
   installed AVD or an authorized device.
2. Call `mobile_open_simulator` to show the native panel, or reuse an open panel.
   Use `mobile_open_workspace` for the workspace with logs and performance tools.
   In a terminal without MCP Apps, use the tools directly. Do not open a browser.
3. Read any startup error and fix its cause. Confirm device discovery with
   `mobile_list_simulators` or `mobile_list_android_devices`. Setup alone does not
   need to boot a device. Do not download Xcode runtimes without the user's request.
4. Follow the shared Mobile Dev and agent-device skills for device work. The
   bundled agent-device runtime starts on its first command and builds its iOS
   XCTest runner with the local Xcode. Use `device_doctor` for a reported runtime
   failure. Do not install a global agent-device CLI.

Claude controls whether the native view opens beside the conversation or inline.
If the side panel is unavailable, use its expand control where offered.
