# Physical iOS unified logs

`mobile-dev-ios-logs` opens `com.apple.os_trace_relay` using libimobiledevice's
device, pairing, TLS, and service APIs. It reads the relay synchronously so
connection closure reaches the plugin's reconnect loop. Each packet is bounded
to 1 MiB and released after processing; stdout is a stream of NDJSON records,
with no native queue. Diagnostics go to stderr.

The first line is `{"ready":true}`, emitted after the phone accepts StartActivity.
Records use the same field names as simulator unified logs, including
`senderImagePath` for the plugin's optional default framework exclusions. Messages
are capped at 16 KiB, sender paths at 4 KiB, and subsystem/category values at 1 KiB. Timestamps include the device's
UTC date and microseconds. An optional exact executable-name filter operates
before JSON serialization and survives PID changes across app restarts.

The reader needs an existing trusted USB or Wi-Fi connection. It does not launch
an app, attach a debugger, install an SDK, or change signing requirements. It
cannot capture ordinary stdout/stderr print statements or recover values that
iOS redacted from unified logs.

Rebuild with `npm run rebuild:ios-logs` on an Apple Silicon Mac with Xcode's C
compiler, `make`, `pkg-config`, and Homebrew OpenSSL 3 installed. Set
`MOBILE_DEV_OPENSSL_PREFIX` to use another OpenSSL build prefix. The script checks
the SHA-256 of each pinned source archive in `dependencies.json`, builds the
libimobiledevice stack, bundles its dylibs and OpenSSL, rewrites their paths to
`@loader_path`, and signs the binaries. End users need no Homebrew installation.
`vendor/ios-logs/release.json` records source provenance and binary hashes; the
plugin build verifies them before copying the reader into `dist/ios-logs`.

`third-party-licenses.txt` contains the LGPL 2.1 licenses for the libimobiledevice
stack and the OpenSSL license. `sources/` ships the complete unmodified
libimobiledevice dependency archives recorded in `release.json`. The collector
adapts libimobiledevice's relay framing under LGPL 2.1 or later. The libraries remain dynamically
linked and replaceable. The collector source and its build script ship alongside
the binaries.

`npm run test:ios-logs -- --device <hardware-udid>` reads logs through the built
MCP server from an already connected phone, prints only counts, and closes its
own log session. An optional `--process <executable-name>` checks app filtering.
