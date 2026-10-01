# Physical iOS performance helper

A standalone macOS arm64 helper using idevice's paired-device CoreDeviceProxy userspace tunnel for Instruments graphics DTX and the device debugproxy. Requires physical iOS 17.4+ devices with Developer Mode enabled. No root, app SDK, Python runtime or Instruments GUI is needed. Display FPS does not attach a debugger; CPU and memory attach to an already running app.

`mobile-dev-ios-fps fps <UDID>` reads the global `CoreAnimationFramesPerSecond` counter at a one-second sampling interval. It omits the immediate baseline measurement and never substitutes a missing counter with zero. EOF on stdin or SIGTERM stops sampling and closes the developer connection. Idle displays can report zero; this measures display updates rather than panel refresh rate, and does not attribute a change to an app.

`mobile-dev-ios-fps debugserver <UDID>` opens the device debugproxy through the same paired-device tunnel. It publishes a loopback TCP port as one JSON line and forwards the GDB protocol until the client disconnects, stdin closes, or SIGTERM arrives. The existing CPU collector negotiates detach-on-error before attaching by PID, streams thread CPU counters and physical memory footprint, and detaches without terminating the app. This mode requires a development-signed app with `get-task-allow`, a mounted developer disk image, and no existing debugger attachment. Attach and detach briefly pause the app; neither launches or restarts it.

Build using `npm run rebuild:ios-fps`. Cargo.lock and the idevice Git revision pin dependencies; the build records source and binary SHA-256 hashes and dependency licenses in vendor/ios-fps.
