import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import type { Duplex, Readable, Writable } from "node:stream";

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

// Copies source to destination and calls `end` once everything has been written. With a pacer, bytes
// and the end of the stream arrive when the link would deliver them: one timer drains a single queue,
// so they keep their order however Node orders timers, and the source pauses while too much is in flight.
export function relay(source: Readable, destination: Writable, pacer?: LinkPacer, end = () => { destination.end(); }) {
  if (!pacer) {
    source.pipe(destination, { end: false });
    source.once("end", end);
    return;
  }
  // A null piece marks the end of the stream.
  const queue: { piece: Buffer | null; at: number }[] = [];
  let queued = 0;
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => { timer = setTimeout(drain, Math.max(0, Math.ceil(queue[0].at - performance.now()))); };
  const drain = () => {
    timer = undefined;
    while (queue.length && queue[0].at <= performance.now()) {
      const { piece } = queue.shift()!;
      if (piece === null) { end(); return; }
      queued -= piece.length;
      if (destination.writable) destination.write(piece);
    }
    if (queued < queuedLimit && source.isPaused()) source.resume();
    if (queue.length) schedule();
  };
  source.on("data", (data: Buffer) => {
    for (let offset = 0; offset < data.length; offset += chunkBytes) {
      const piece = data.subarray(offset, offset + chunkBytes);
      queue.push({ piece, at: pacer.arrival(piece.length) });
      queued += piece.length;
    }
    if (queued >= queuedLimit) source.pause();
    if (!timer) schedule();
  });
  source.once("end", () => {
    queue.push({ piece: null, at: pacer.arrival(0) });
    if (!timer) schedule();
  });
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
type Link = { down: LinkPacer; up: LinkPacer };

// An HTTP proxy that throttles tunnels and plain requests to the profile's latency and bandwidth.
export class ThrottleProxy {
  readonly token = randomUUID();
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly link: Link;
  private readonly isLocal: (host: string) => boolean;

  constructor(profile: LinkProfile, isLocal = isLocalDestination) {
    this.link = { down: new LinkPacer(profile), up: new LinkPacer(profile) };
    this.isLocal = isLocal;
    this.server = createServer((request, response) => this.forward(request, response));
    this.server.on("connect", (request: IncomingMessage, socket: Duplex, head: Buffer) => this.tunnel(request, socket as Socket, head));
    this.server.on("connection", socket => { this.sockets.add(socket); socket.once("close", () => this.sockets.delete(socket)); });
  }

  set profile(profile: LinkProfile) { this.link.down.profile = profile; this.link.up.profile = profile; }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve((this.server.address() as { port: number }).port));
    });
  }

  // Local destinations get no pacers, so they pass through at full speed.
  private pacers(host: string): Partial<Link> { return this.isLocal(host) ? {} : this.link; }

  private tunnel(request: IncomingMessage, client: Socket, head: Buffer) {
    const target = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(request.url ?? "");
    if (!target) { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    const { down, up } = this.pacers(target[1]);
    // Each side half-closes on its own, so bytes still being paced reach the app after the server
    // closes. The app's socket is released once both directions are done.
    const upstream = connect({ port: Number(target[2]), host: hostAddress(target[1]), allowHalfOpen: true });
    this.sockets.add(upstream);
    const release = () => { if (upstream.destroyed && client.writableFinished) client.destroy(); };
    upstream.once("close", () => { this.sockets.delete(upstream); release(); });
    client.once("close", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      relay(upstream, client, down, () => { client.end(release); });
      relay(client, upstream, up);
    });
  }

  private forward(request: IncomingMessage, response: ServerResponse) {
    // The plugin checks a device's proxy is still alive by asking for the owner's token.
    if (request.url === healthPath) { response.end(this.token); return; }
    let url: URL;
    try { url = new URL(request.url ?? ""); } catch { response.writeHead(400).end(); return; }
    if (url.protocol !== "http:") { response.writeHead(400).end(); return; }
    const { down, up } = this.pacers(url.hostname);
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    // Like the response below, the request's headers go out with its first paced bytes or its paced end.
    let replied = false;
    const upstream = httpRequest({ host: hostAddress(url.hostname), port: url.port || 80, path: `${url.pathname}${url.search}`, method: request.method, headers }, reply => {
      replied = true;
      // Headers go out with the first body bytes, so they share the body's paced arrival.
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.on("error", () => response.destroy());
      relay(reply, response, down);
    });
    // A reply that breaks off midway closes the app's connection; one that never started is a 502.
    upstream.on("error", () => { if (replied) response.destroy(); else response.writeHead(502).end(); });
    // A request the app gave up on stops downloading, so it no longer uses the link.
    response.once("close", () => { if (!response.writableFinished) upstream.destroy(); });
    request.on("error", () => upstream.destroy());
    relay(request, upstream, up);
  }

  close() {
    for (const socket of this.sockets) socket.destroy();
    return new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

// The token of the proxy listening on this port, or null when none answers.
export async function proxyToken(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${healthPath}`, { signal: AbortSignal.timeout(1000) });
    return response.ok ? await response.text() : null;
  } catch { return null; }
}
