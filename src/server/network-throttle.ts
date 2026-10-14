import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import type { Duplex, Readable, Writable } from "node:stream";
import { ExpectedOperationError } from "../shared/error-reporting.ts";
import { networkPresets, type NetworkPreset } from "../shared/device-settings.ts";
import { commandError, commandOutput, systemCommands, type Commands } from "./app-control/commands.ts";

export type LinkProfile = { latencyMs: number; bandwidthKbps: number };

// One direction of a simulated link, shared by every connection on the device so they compete for
// the same bandwidth. Half the round-trip latency applies each way.
export class LinkPacer {
  profile: LinkProfile;
  private nextFree = 0;
  private readonly now: () => number;
  constructor(profile: LinkProfile, now = () => performance.now()) { this.profile = profile; this.now = now; }
  arrival(bytes: number): number {
    const start = Math.max(this.now(), this.nextFree);
    this.nextFree = start + bytes * 8 / this.profile.bandwidthKbps;
    return this.nextFree + this.profile.latencyMs / 2;
  }
}

const chunkBytes = 16 * 1024;
const queuedLimit = 256 * 1024;

// Delivers source chunks to the destination when the pacer says they arrive, keeping their order and
// pausing the source while too much is in flight.
export function pacedPipe(source: Readable, destination: Writable, pacer: LinkPacer, now = () => performance.now()) {
  let queued = 0;
  let last = 0;
  let ended = false;
  const finish = () => { if (ended && queued === 0) destination.end(); };
  source.on("data", (data: Buffer) => {
    for (let offset = 0; offset < data.length; offset += chunkBytes) {
      const piece = data.subarray(offset, offset + chunkBytes);
      last = Math.max(last, pacer.arrival(piece.length));
      queued += piece.length;
      setTimeout(() => {
        queued -= piece.length;
        if (!destination.destroyed) destination.write(piece);
        if (queued < queuedLimit && source.isPaused()) source.resume();
        finish();
      }, Math.max(0, last - now()));
    }
    if (queued >= queuedLimit) source.pause();
  });
  source.once("end", () => { ended = true; finish(); });
}

// Development servers on the Mac or the local network stay at full speed, such as Metro at 10.0.2.2:8081.
export function isLocalDestination(host: string) {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (name === "localhost" || name.endsWith(".local") || name === "::1") return true;
  if (isIP(name) !== 4) return false;
  const [a, b] = name.split(".").map(Number);
  return a === 127 || a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
}

// The emulator reaches the Mac at 10.0.2.2, and adb reverse maps a phone's localhost to it.
const hostAddress = (host: string) => /^(?:10\.0\.2\.2|localhost)$/i.test(host) ? "127.0.0.1" : host.replace(/^\[|\]$/g, "");
const healthPath = "/mobile-dev-network-throttle";

// An HTTP proxy that throttles tunnels and plain requests to the profile's latency and bandwidth.
export class ThrottleProxy {
  readonly token = randomUUID();
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly down: LinkPacer;
  private readonly up: LinkPacer;

  constructor(profile: LinkProfile) {
    this.down = new LinkPacer(profile);
    this.up = new LinkPacer(profile);
    this.server = createServer((request, response) => this.forward(request, response));
    this.server.on("connect", (request: IncomingMessage, socket: Duplex, head: Buffer) => this.tunnel(request, socket as Socket, head));
    this.server.on("connection", socket => { this.sockets.add(socket); socket.once("close", () => this.sockets.delete(socket)); });
  }

  set profile(profile: LinkProfile) { this.down.profile = profile; this.up.profile = profile; }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve((this.server.address() as { port: number }).port));
    });
  }

  private tunnel(request: IncomingMessage, client: Socket, head: Buffer) {
    const target = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(request.url ?? "");
    if (!target) { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    const local = isLocalDestination(target[1]);
    const upstream = connect(Number(target[2]), hostAddress(target[1]));
    this.sockets.add(upstream);
    upstream.once("close", () => { this.sockets.delete(upstream); client.destroy(); });
    client.once("close", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      if (local) { upstream.pipe(client); client.pipe(upstream); return; }
      pacedPipe(upstream, client, this.down);
      pacedPipe(client, upstream, this.up);
    });
  }

  private forward(request: IncomingMessage, response: ServerResponse) {
    // The plugin checks a device's proxy is still alive by asking for the owner's token.
    if (request.url === healthPath) { response.end(this.token); return; }
    let url: URL;
    try { url = new URL(request.url ?? ""); } catch { response.writeHead(400).end(); return; }
    if (url.protocol !== "http:") { response.writeHead(400).end(); return; }
    const local = isLocalDestination(url.hostname);
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const send = () => {
      const upstream = httpRequest({ host: hostAddress(url.hostname), port: url.port || 80, path: `${url.pathname}${url.search}`, method: request.method, headers }, reply => {
        const respond = () => {
          response.writeHead(reply.statusCode ?? 502, reply.headers);
          if (local) reply.pipe(response); else pacedPipe(reply, response, this.down);
        };
        if (local) respond(); else setTimeout(respond, Math.max(0, this.down.arrival(0) - performance.now()));
      });
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      if (local) request.pipe(upstream); else pacedPipe(request, upstream, this.up);
    };
    if (local) send(); else setTimeout(send, Math.max(0, this.up.arrival(0) - performance.now()));
  }

  close() {
    for (const socket of this.sockets) socket.destroy();
    return new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

// Bandwidth presets match iOS; latency is the round trip, so each direction carries half.
const profileFor = (preset: NetworkPreset): LinkProfile => networkPresets[preset];
const marker = "mobile_dev_network_throttle";
const emulatorSerial = /^emulator-\d+$/;
type DeviceState = { proxy: string | null; owner: { token: string; port: number; preset: NetworkPreset } | null };
export type ThrottleReading = { preset: NetworkPreset | null } | { foreignProxy: string };

export function parseThrottleState(output: string): DeviceState {
  const [proxyLine = "", markerLine = ""] = output.split("\n").map(line => line.trim());
  const proxy = proxyLine === "null" || proxyLine === "" || proxyLine === ":0" ? null : proxyLine;
  const match = /^([0-9a-f-]{36}):(\d+):(lte|3g|edge)$/.exec(markerLine);
  return { proxy, owner: match ? { token: match[1], port: Number(match[2]), preset: match[3] as NetworkPreset } : null };
}

// Android throttling points the device's global proxy at a ThrottleProxy on the Mac. A marker setting
// records which proxy owns the device so any plugin process can tell its own setup from the user's
// proxy and clear a setup whose process is gone, which would otherwise leave the device offline.
export class AndroidNetworkThrottle {
  private readonly proxies = new Map<string, { proxy: ThrottleProxy; port: number }>();
  private readonly commands: Commands;
  private readonly alive: (port: number) => Promise<string | null>;

  constructor(commands: Commands = systemCommands, alive = proxyToken) { this.commands = commands; this.alive = alive; }

  private async shell(serial: string, action: string, command: string) {
    try { return await this.commands.run(await this.commands.adb(), ["-s", serial, "shell", command], { timeout: 10000 }); }
    catch (error) { throw commandError(error, action); }
  }

  private async adb(serial: string, action: string, args: string[]) {
    try { await this.commands.run(await this.commands.adb(), ["-s", serial, ...args], { timeout: 10000 }); }
    catch (error) { if (!/not found|listener .* not found/i.test(commandOutput(error))) throw commandError(error, action); }
  }

  private async state(serial: string) {
    return parseThrottleState(await this.shell(serial, "Reading the network throttle", `settings get global http_proxy; settings get global ${marker}`));
  }

  private proxyAddress(serial: string, port: number) { return `${emulatorSerial.test(serial) ? "10.0.2.2" : "127.0.0.1"}:${port}`; }

  // A marker only counts while the device still points at the proxy it names.
  private ours(serial: string, state: DeviceState) {
    return state.owner !== null && state.proxy === this.proxyAddress(serial, state.owner.port);
  }

  private async clear(serial: string, port?: number) {
    await this.shell(serial, "Clearing the network throttle", `settings put global http_proxy :0 && settings delete global http_proxy && settings delete global ${marker}`);
    if (port !== undefined && !emulatorSerial.test(serial)) await this.adb(serial, "Clearing the network throttle", ["reverse", "--remove", `tcp:${port}`]);
  }

  async read(serial: string): Promise<ThrottleReading> {
    const state = await this.state(serial);
    if (state.owner && !this.ours(serial, state)) {
      // Someone replaced or removed the proxy; drop the marker but leave their setting alone.
      await this.shell(serial, "Reading the network throttle", `settings delete global ${marker}`);
    } else if (state.owner) {
      if (await this.alive(state.owner.port) !== state.owner.token) {
        // The owning plugin process is gone, so the device would have no internet.
        await this.clear(serial, state.owner.port);
        return { preset: null };
      }
      // adb reverse ends when a phone reconnects; restore it for a proxy this process owns.
      if (!emulatorSerial.test(serial) && this.proxies.get(serial)?.port === state.owner.port) await this.adb(serial, "Restoring the network throttle", ["reverse", `tcp:${state.owner.port}`, `tcp:${state.owner.port}`]);
      return { preset: state.owner.preset };
    }
    return state.proxy ? { foreignProxy: state.proxy } : { preset: null };
  }

  async set(serial: string, preset: NetworkPreset | null): Promise<void> {
    const state = await this.state(serial);
    const ours = this.ours(serial, state);
    const current = this.proxies.get(serial);
    if (preset === null) {
      // The user's own proxy stays in place.
      if (ours) await this.clear(serial, state.owner!.port);
      if (current) { this.proxies.delete(serial); await current.proxy.close(); }
      return;
    }
    if (state.proxy && !ours) {
      throw new ExpectedOperationError("invalid_input", `This device already uses the proxy ${state.proxy}. Remove it to simulate a slower network.`);
    }
    const link = current ?? await this.start();
    this.proxies.set(serial, link);
    link.proxy.profile = profileFor(preset);
    if (!emulatorSerial.test(serial)) await this.adb(serial, "Throttling the network", ["reverse", `tcp:${link.port}`, `tcp:${link.port}`]);
    await this.shell(serial, "Throttling the network", `settings put global http_proxy ${this.proxyAddress(serial, link.port)} && settings put global ${marker} ${link.proxy.token}:${link.port}:${preset}`);
  }

  private async start() {
    const proxy = new ThrottleProxy(profileFor("lte"));
    return { proxy, port: await proxy.listen() };
  }

  // Devices still pointing at this process's proxies would lose internet once it exits.
  async close() {
    await Promise.allSettled([...this.proxies].map(async ([serial, { proxy, port }]) => {
      try {
        const state = await this.state(serial);
        if (this.ours(serial, state) && state.owner!.token === proxy.token) await this.clear(serial, port);
      } finally { await proxy.close(); }
    }));
    this.proxies.clear();
  }
}

async function proxyToken(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${healthPath}`, { signal: AbortSignal.timeout(1000) });
    return response.ok ? await response.text() : null;
  } catch { return null; }
}
