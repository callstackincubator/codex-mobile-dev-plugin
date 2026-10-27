# Mobile Dev Android runtime

This is a checked-in source fork of serve-emu 0.0.6 by jiunshinn, licensed under
Apache 2.0. `upstream.json` records its upstream repository, npm tarball, and
integrity hash. `LICENSE` retains the upstream license. The server modules and
prebuilt standalone web UI were copied from that release; the plugin has its own
device panel and does not build or use the standalone UI.

Mobile Dev replaces the Bun CLI, HTTP/WebSocket server, and file APIs with Node.js
22.18+ and ws. It preserves the scrcpy protocol, session lifecycle, input queues,
bounded uploads, frame backpressure, and keyframe recovery. It also shortens the
scrcpy launch command for physical Android devices and requires the checked-in,
verified scrcpy 4.0 server instead of downloading a runtime during startup.
The upstream CLI update check is removed because this fork ships with the plugin.
Modified upstream files carry a Mobile Dev modification notice.

Edit the source here directly. There is no serve-emu npm dependency or package
patch. `npm run vendor:serve-emu` installs only the pinned Node dependencies and
checks the scrcpy binary. `npm run build` emits `dist/serve-emu/src/cli.mjs`, copies
dependencies, assets, source, and licenses, and records their hashes in
`dist/serve-emu/release.json`. The plugin starts the CLI with `process.execPath`.

The bundled scrcpy server is Apache 2.0 licensed:
https://github.com/Genymobile/scrcpy/releases/tag/v4.0
The ws and @fastify/busboy packages retain their MIT licenses in node_modules.
