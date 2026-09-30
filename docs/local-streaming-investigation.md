# Local simulator streaming investigation

Recorded on 2026-09-30. This branch preserves the H.264 streaming experiment, certificate setup, shared streaming service, tests, and plugin version 0.1.18.

## Historical checkpoint

This document describes commit `9313bbb` (plugin 0.1.18), which preserves the direct H.264/WSS experiment. The current 0.1.33 implementation replaces it with latest-frame MJPEG reads through the MCP host bridge. The shared WSS service, certificate tools, and direct browser transport are removed; the prior investigation remains here as historical evidence. See [MCP frame polling measurements](mcp-frame-polling.md) for the replacement and its validation.

## Result at the WSS checkpoint

**Embedded video remains blocked in Codex Desktop 26.928.21956, build 12404.** The panel loads, its CSP matches the stream endpoint, and the local server delivers H.264 to a Node WebSocket client with certificate validation enabled. The actual panel fails with:

```text
WebSocket connection to 'wss://127.0.0.1:49321/<redacted-session-token>' failed:
Error in connection establishment: net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS
```

No local-network permission prompt appeared. We found no supported plugin setting or metadata field that enables the required browser permission in the installed host. This is an observed limitation of that host build, not a claim that browser sandboxes cannot support local streaming.

The upstream report is [openai/codex#49679: Desktop: MCP App loopback WebSocket blocked by Local Network Access despite CSP allowance](https://github.com/openai/codex/issues/49679). It asks whether a supported permission flow exists and, if not, requests documented, user-approved loopback access or a supported local streaming transport. It does not assume that the current policy is an unintended bug.

Ordinary MCP calls, device discovery, screenshots, accessibility tools, and log reads use the host bridge and do not require a browser-to-localhost connection. These remain independent of the video permission failure.

## Why try a different transport?

The previous viewer requested individual MJPEG frames over MCP and sent gestures through MCP tool calls. The user observed roughly 20 FPS and noticeable interaction latency. Each frame crossed the MCP request/response path and host bridge. Avoiding those per-frame round trips motivated the new transport; we did not complete a quantitative latency breakdown or establish a measured 60 FPS result in the embedded viewer.

The MCP Apps and OpenAI extensions protocols provide an isolated web UI and a JSON-RPC host bridge. We found no documented API for passing an IOSurface or another native GPU surface pointer to an iframe's canvas. A pointer from the simulator process would not itself supply a cross-process GPU-sharing mechanism to that web UI. The transport implemented here sends encoded video bytes and lets WebCodecs decode them.

Baguette's native capture path uses IOSurface/CVPixelBuffer and VideoToolbox for H.264 encoding. That native implementation is distinct from the browser's decoding and rendering path; `hardwareAcceleration: "prefer-hardware"` is a decoder preference, not a zero-copy or hardware-decoding guarantee.

## Implemented transport

The implementation has two paths:

```text
Panel --MCP host bridge--> plugin: certificate status/setup, session open/close

Panel --WSS :49321--> shared service --internal WS--> owning MCP worker --WS--> Baguette
                          ^
                          |
                 private Unix control socket
                          |
                    owning MCP worker
```

The second path carries binary H.264 frames and JSON gestures without per-frame MCP requests. It is the path blocked by the current desktop permission gate.

### Stable endpoint across MCP processes

The public endpoint is always `wss://127.0.0.1:49321`. All production MCP instances advertise that exact origin in both HTML configuration and resource CSP. UI addresses are stable for the release:

- `ui://mobile-dev/0.1.18/shared-stream/simulator.html`
- `ui://mobile-dev/0.1.18/shared-stream/workspace.html`

The service starts on demand by launching the same bundled server with `--stream-service`. MCP clients register their internal stream targets through `~/Library/Application Support/Mobile Dev/streaming-v1/control.sock`. The directory is private and the socket has mode `0600`. The shared service forwards raw WebSocket payloads; it does not serialize video through the control socket.

Each route belongs to the MCP client's control connection. Closing that connection closes its routes without closing another client's streams. The service exits 30 seconds after its last client disconnects. Startup binds the fixed TCP port before replacing a stale control socket, so competing launches cannot remove the running service's socket. An occupied fixed port is an error; the service does not choose a different public port.

Each MCP process still owns its Baguette child and an internal loopback WebSocket relay. Their ports may change without changing the browser's endpoint. Repairing input closes the owning worker's device captures, which also disconnects the corresponding public streams.

### Sessions and input

Sessions use random 32-byte tokens encoded as 64 hexadecimal characters. An unused token expires after one minute, and only one browser can connect to it. Heartbeats and bounded socket buffers close stalled receivers. Closing a viewer releases its upstream capture.

Gestures use the same socket as video. The worker validates messages against the input schema and checks whether Xcode Device Hub blocks interaction. Video failure does not authorize an input repair. Repair remains an explicit action because it restarts simulator services and closes running apps.

The old MCP frame resource and `mobile_stream_input` transport were removed. There is no MJPEG transport fallback. This branch is consequently an incomplete embedded streaming experiment while the host permission remains unavailable.

### Baguette packet format and browser rendering

The upstream endpoint is `/simulators/<UDID>/stream?format=avcc`. Binary packets begin with a one-byte tag:

| Tag | Payload | Viewer behavior |
| --- | --- | --- |
| 1 | AVC decoder configuration record (AVCC) | Configure the H.264 decoder and derive its codec string from profile, compatibility, and level bytes |
| 2 | H.264 keyframe | Decode as a key chunk |
| 3 | H.264 delta frame | Decode as a delta chunk |
| 4 | JPEG seed frame | Ignore; it is not an alternate video transport |

The worker requests 60 FPS, scale 2, and a 4,000,000-bit/s bitrate. The browser requests low-latency decoding and prefers hardware acceleration. It keeps only the latest pending `VideoFrame`, paints on `requestAnimationFrame`, and closes replaced frames. A decoder queue that grows beyond the limit stops the connection rather than building an ever-longer playback delay.

## Failures investigated

### Black screen: opaque bezel covered the canvas

The earlier black screen was a CSS layering issue. The opaque device bezel covered the simulator canvas. Commit `ccc649c` puts the canvas above the bezel while retaining the screen mask and placement. This fix is already in the branch's parent history and is unrelated to the later network failures.

### Plain HTTP/WS origins were not retained in the widget CSP

Inspection of the installed desktop resource parser showed that ordinary HTTP and WS origins were filtered from widget CSP. HTTPS and WSS origins were accepted. TLS therefore addressed a CSP prerequisite, but it did not grant browser local-network access.

The parser also normalizes origins through URL parsing. A port wildcard such as `wss://127.0.0.1:*` was not a usable way to permit changing ports in this build.

### Hostname-scoped Keychain trust did not satisfy Chromium

The initial setup used `security add-trusted-cert` with a hostname policy string (`-s 127.0.0.1`). Native `security verify-cert` could succeed while Chromium ignored that trust entry. Chromium's macOS trust-store implementation skips hostname- and application-scoped trust entries.

The setup command now requests user SSL trust without the hostname policy string. The certificate itself restricts its identity to SAN IP `127.0.0.1`, has `CA:FALSE`, and is valid for server authentication. Removing the trust-setting hostname scope does not change those certificate constraints.

Certificate status checks perform native verification and inspect the actual exported user trust record for hostname/application scoping. There is no marker file standing in for trust. Explicit setup repairs an old trust entry without unnecessarily generating another keypair.

Certificate creation and Keychain trust are initiated only by the setup button or an explicit user setup request. Merely opening the panel checks status. The certificate and key live under `~/Library/Application Support/Mobile Dev/tls`, with mode `0600` inside a private directory. The certificate lasts one year. Removing it from the login Keychain revokes trust; deleting the TLS directory removes the stored files.

### Random per-process ports disagreed with cached CSP

The browser attempted to connect to `wss://127.0.0.1:63754` while its loaded CSP allowed `wss://127.0.0.1:63483`. The actual console error identified that mismatch. Building HTML and CSP from the same process-local value was insufficient because discovery, resource reads, and tool calls did not necessarily use that same process or cached resource.

### Per-process UI addresses caused “Couldn't display”

An attempted fix put a random instance UUID and the port into the UI resource URI and required an embedded instance ID when opening a session. Desktop logs then showed `Resource ui://mobile-dev/0.1.18/wss/<instance>/<port>/simulator.html not found` before any HTML loaded.

That approach assumed discovery and resource reads would reach the same MCP instance. The tests had incorrectly treated rejection of another instance's URI as desirable. The shared service and stable UI addresses replace that assumption. Tests now use one instance's advertised address to read a resource through another instance and check agreement after replacement. Legacy UI aliases and per-process viewer IDs were removed rather than retained as another path.

### Current failure: Chromium Local Network Access

After the certificate and CSP issues were resolved, the panel reported `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` for the stable endpoint. This permission is separate from both TLS trust and CSP.

Read-only inspection of the installed desktop code found:

- The native MCP sandbox permission handler grants `local-network` only to a sandbox identified as local-network-enabled and only when the requesting origin matches that sandbox.
- The renderer has a host-side `sandboxFeatures` mechanism that can enable `local-network-access` and identify a sandbox accordingly.
- Our local stdio plugin panel did not receive that capability. The resource metadata parser does not expose it as a plugin-controlled permission field, and the relevant general CSP-derived opt-in helper returned false in this build.

These are observations of compiled host internals, not a public API contract or a supported setting. We did not modify the desktop application, disable browser protections, or establish a plugin-only way to request the grant. Unknown metadata fields should not be presented as a confirmed solution.

macOS **Privacy & Security → Local Network** is a separate application-level permission. Changing it alone cannot override the host's denial of the web panel's browser permission. Repeating certificate setup, reopening the panel, or repairing simulator input does not fix this denial.

The UI's generic WebSocket error combines certificate and permission advice because JavaScript's WebSocket error event does not supply the browser's detailed network error. The console error is the evidence that distinguishes this failure. That generic advice should not be interpreted as proof that a user can enable the missing host capability.

## Alternatives discussed

| Approach | Finding |
| --- | --- |
| Native GPU surface pointer passed into the plugin canvas | No documented extension API found; native pointer sharing is not implemented |
| Plugin CSP and trusted local certificate | Necessary for the chosen WSS transport, but insufficient to grant Local Network Access |
| `/etc/hosts` alias or public DNS name resolving to loopback | Still classified by the resolved loopback IP; does not remove the permission requirement |
| Host-supported, user-approved loopback capability | Requested in the upstream issue; no available setting verified in the observed build |
| Actual public WSS relay with outbound connections from the panel and backend | Conceptually feasible; not implemented or benchmarked; adds an internet hop and sends traffic through the relay |
| Standalone local viewer | Discussed, but the user wants the viewer embedded; not implemented |

An aliased hostname is not the same as a real public relay. Chromium classifies local-network destinations using resolved addresses. A relay with a genuinely public destination would avoid a browser-to-localhost request, but its performance, operating cost, and privacy behavior would need separate evaluation.

## Validation and its limits

The final source test suite passed **35 tests**, using Node.js 26.3.0. The project requires Node.js 22.18 or later; the shell's older default Node cannot run these TypeScript source tests directly.

Coverage includes certificate command behavior and scoped-trust repair; session authorization, validation, expiry, and cleanup; binary forwarding and gestures; blocked-input behavior; shared-service ownership and competing launches; recovery from a stale Unix socket; cross-instance UI/CSP agreement; reconnect cancellation; existing log workflows; and mocked WebCodecs configuration/key/delta decoding.

The build and packaging completed. The copied-package smoke test launched the bundled backend, returned 78 available simulators, checked shutdown, and used **separate Node MCP processes** to verify identical UI HTML and CSP from a discovery-advertised resource address.

The native reconnect smoke test used an already booted iPhone simulator. It verified H.264 configuration and keyframes over WSS with CA verification, stopped only its copied package's own Baguette child, recovered through a new session with the same public origin, and closed capture. It did not boot, repair, or send gestures to the simulator.

**None of these passing Node or mocked-decoder checks proves that Codex's browser grants the required permission or that the embedded viewer sustains 60 FPS.** The real panel test remains the failing host integration check. Full browser streaming, gesture latency, sustained throughput, GPU decode behavior, and end-to-end recovery are still unverified in the embedded host.

To repeat the source and package checks with a compatible Node runtime:

```sh
npm test
npm run build
npm run package
npm run test:package
npm run test:reconnect -- <already-booted-simulator-UDID>
```

The native reconnect test also requires the existing local certificate setup. Do not change Keychain trust or repair simulator input merely to reproduce the browser permission failure.

## Continuing this work

Preserve the distinction between working backend transport and blocked host integration. Ask the Codex team which documented permission or streaming mechanism local MCP Apps can use. If a capability becomes available, validate it in the actual embedded panel before claiming success, then measure sustained FPS and input latency. Do not revive the old frame transport or add another transport as a fallback without user agreement.

This commit is an investigation checkpoint, not a completed streaming release. Generated `dist`, release packages, vendor binaries, TLS material, and raw host logs are not part of the source commit.

## Sources

- [OpenAI plugin extensions](https://developers.openai.com/plugins/build/extensions): extension and host-bridge interfaces.
- [MCP Apps UI and CSP](https://developers.openai.com/plugins/build/chatgpt-ui): UI resource registration, tool calls, cache keys, and origin declarations.
- [OpenAI MCP extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md): protocol reference inspected during the investigation.
- [Baguette 0.2.1 source](https://github.com/tddworks/baguette/tree/db17446e25059247879dba7941e4de641c2f31e2): pinned backend implementation.
- [Chromium macOS trust-store implementation](https://chromium.googlesource.com/chromium/src/+/main/net/cert/internal/trust_store_mac.cc): handling of scoped Keychain trust entries.
- [Chrome Local Network Access explanation](https://developer.chrome.com/blog/local-network-access) and [current explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md): permission boundaries and destination address classification. The older Chrome blog's initial rollout notes are not a current WebSocket support guarantee.
- [Upstream report #49679](https://github.com/openai/codex/issues/49679): observed error, reproduction outline, and requested supported permission flow.

Host observations came from read-only inspection of the installed app bundle and desktop logs. They may change with a host update and should be rechecked rather than treated as stable plugin configuration.
