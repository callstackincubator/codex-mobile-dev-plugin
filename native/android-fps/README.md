# FrameTimeline Display FPS collector

This external Android 12+ helper uses the Perfetto v25.0 SDK's system consumer backend. It records only `android.surfaceflinger.frametimeline`, flushes and reads its bounded 4 MiB buffer once per second, and streams binary trace packets to the host. It creates no trace file. The host counts presented actual DisplayFrames, not app/layer SurfaceFrames, and excludes dropped frames.

The host publishes one-second intervals with a two-second readback delay. SurfaceFlinger can resolve present fences on a later display update; those frames revise their original interval, without moving them to the time of receipt. Zero means no display update was observed in the interval; a quiet or locked screen can report zero. A disconnected or failed collector reports an error rather than continuing to publish zeros.

EOF or data on stdin, SIGINT or SIGTERM stops the tracing session. The helper runs as ADB shell, without root, debugger attachment or an app SDK. There is no implementation for older Android versions or absent FrameTimeline sources.

Build all four Android ABIs using `ANDROID_NDK_HOME=/path/to/ndk npm run rebuild:android-fps`. The build pins the vendored Perfetto SDK and records source/binary SHA-256 hashes. Perfetto is Apache-2.0 licensed; its source and license are in perfetto/.
