# Android CPU collector

CPU-only adaptation of [BAM Flashlight's native Android collector](https://github.com/bamlab/flashlight/blob/5ef203ae184547a3b2984fa4f9b76d672895f861/packages/platforms/android/cpp-profiler/src/main.cpp), commit `5ef203ae184547a3b2984fa4f9b76d672895f861`, under the MIT License (see LICENSE).

Reads process and thread `/proc` counters once per second over a persistent ADB shell. Uses process totals including exited threads and thread birth times to distinguish reused IDs. No debugger, SDK, root, atrace, FPS or memory collector is used. Devices whose security policy blocks shell access to app counters report an error.

The collector exits on stdin input/EOF, ADB disconnection, SIGTERM, or target exit/restart. It never signals the target. Kernel counters have clock-tick resolution (usually 10 ms); 100% means one occupied device CPU core. Measures the selected package's main process.

Rebuild the four bundled ABI binaries with `npm run rebuild:android-cpu`, setting `ANDROID_NDK_HOME` to an NDK installation. NDK 29 / Clang 21 and API 21 produced the current binaries. `vendor/android-cpu/release.json` records source and binary SHA-256 hashes. Normal plugin builds and users do not require an NDK.
