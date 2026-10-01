# Physical iOS screen capture

This Node-API 8 addon opens a private developer tunnel through the Mac's existing `usbmuxd` pairing, negotiates CoreDevice displayservice, and assembles complete HEVC access units. USB and paired Wi-Fi use the same capture path. No iPhone app or root access is required.

The phone encodes its display. The addon transfers each final compressed allocation into an external Node Buffer; its finalizer retains that allocation until JavaScript releases it. Raw pixels never cross the native/Node boundary. MCP then base64 encodes the compressed bytes, so the complete path is **not** zero copy. The panel uses WebCodecs HEVC decoding and closes every VideoFrame after drawing it.

The native queue holds at most eight frames or 4 MiB. Overflow invalidates the decoder generation, drops queued frames, and requests a fresh keyframe. Only complete access units with validated parameter sets reach Node. The capture session owns its UDP sockets, tunnel, and stream identities returned by the device. Teardown names those identities in `stopmediastream`; it never uses `stopAll=true`.

Build with `npm run rebuild:ios-mirror` on an Apple Silicon Mac with Rust and Xcode command line tools. `Cargo.lock` pins all native dependencies. End users receive the prebuilt addon and need no compiler. The plugin build verifies the source and binary hashes.

Protocol transport uses [idevice](https://github.com/jkcoxson/idevice) at `a64b8867815b3da17b5c927531bdba877e8456ef` (MIT). The media parser and negotiation files are derived from idevice plus [device-hub-ios](https://github.com/JaviSoto/device-hub-ios) at `1fcdfb0a6799b62f05625d0cbb359bec57256b94`'s focused display-stream patches (MIT); see the included license files. The vendored media module is separate from our bridge/session code.

The live development check used an iPhone 17 Pro on iOS 27 over Wi-Fi. The display service is private and can change with iOS/Xcode releases; unsupported negotiation or HEVC decoder configurations fail explicitly.
