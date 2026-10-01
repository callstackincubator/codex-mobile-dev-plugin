# Display FPS collector

A standalone macOS arm64 helper using idevice's paired-device CoreDeviceProxy userspace tunnel and Instruments graphics DTX service. Requires physical iOS 17.4+ devices with Developer Mode enabled. No root, app SDK, LLDB attachment, Python runtime or Instruments GUI is needed.

The helper reads the global `CoreAnimationFramesPerSecond` counter at a one-second sampling interval. It omits the immediate baseline measurement and never substitutes a missing counter with zero. EOF on stdin or SIGTERM stops sampling and closes the developer connection. Idle displays can report zero; this measures display updates rather than panel refresh rate, and does not attribute a change to an app.

Build using `npm run rebuild:ios-fps`. Cargo.lock and the idevice Git revision pin dependencies; the build records source and binary SHA-256 hashes and dependency licenses in vendor/ios-fps.
