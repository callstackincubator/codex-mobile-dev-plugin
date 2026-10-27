import { createServer, ServerResponse, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { WebSocket, WebSocketServer } from "ws";

export type ServerWebSocket<T> = WebSocket & { data: T };

export type NodeServer<T> = {
  port: number;
  upgrade: (request: Request, options: { data: T }) => boolean;
  timeout: (request: Request, seconds: number) => void;
  stop: () => Promise<void>;
};

export type NodeServerOptions<T> = {
  port: number;
  hostname: string;
  maxRequestBodySize: number;
  fetch: (request: Request, server: NodeServer<T>) => Promise<Response | undefined>;
  websocket: {
    maxPayloadLength: number;
    open: (socket: ServerWebSocket<T>) => void;
    message: (socket: ServerWebSocket<T>, data: string | Buffer) => void;
    close: (socket: ServerWebSocket<T>) => void;
  };
};

type RequestContext = {
  incoming: IncomingMessage;
  socket?: Duplex;
  head?: Buffer;
  upgraded: boolean;
};

class BodyLimitError extends Error {}

async function* limitedBody(incoming: IncomingMessage, limit: number) {
  let bytes = 0;
  for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      incoming.resume();
      throw new BodyLimitError("request body too large");
    }
    yield chunk;
  }
}

async function sendResponse(response: Response, outgoing: ServerResponse, method?: string) {
  outgoing.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") outgoing.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
  if (method === "HEAD" || response.body === null) {
    await response.body?.cancel();
    outgoing.end();
    return;
  }
  outgoing.flushHeaders();
  const body = Readable.fromWeb(response.body);
  await pipeline(body, outgoing);
}

export async function serve<T>(options: NodeServerOptions<T>): Promise<NodeServer<T>> {
  const requests = new WeakMap<Request, RequestContext>();
  const sockets = new Set<Duplex>();
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: options.websocket.maxPayloadLength,
    perMessageDeflate: false,
  });
  const http = createServer();
  const server: NodeServer<T> = {
    port: options.port,
    upgrade(request, { data }) {
      const context = requests.get(request);
      if (context?.socket === undefined || context.head === undefined || context.upgraded) return false;
      context.upgraded = true;
      websocket.handleUpgrade(context.incoming, context.socket, context.head, socket => {
        const client: ServerWebSocket<T> = Object.assign(socket, { data });
        client.on("message", (message, binary) => {
          if (binary) return;
          const payload = message.toString();
          options.websocket.message(client, payload);
        });
        client.on("close", () => options.websocket.close(client));
        client.on("error", () => client.terminate());
        websocket.emit("connection", client, context.incoming);
        options.websocket.open(client);
      });
      return true;
    },
    timeout(request, seconds) {
      const context = requests.get(request);
      context?.incoming.setTimeout(seconds * 1000);
    },
    async stop() {
      const closed = new Promise<void>((resolve, reject) => {
        http.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
      for (const client of websocket.clients) client.terminate();
      websocket.close();
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };

  const handle = async (incoming: IncomingMessage, outgoing?: ServerResponse, socket?: Duplex, head?: Buffer) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const connection = outgoing ?? socket;
    connection?.once("close", abort);
    incoming.once("aborted", abort);
    try {
      const contentLength = Number(incoming.headers["content-length"] ?? 0);
      if (contentLength > options.maxRequestBodySize) throw new BodyLimitError("request body too large");
      const host = incoming.headers.host ?? `${options.hostname}:${server.port}`;
      const url = `http://${host}${incoming.url ?? "/"}`;
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      }
      const init: RequestInit & { duplex?: "half" } = {
        method: incoming.method, headers, signal: controller.signal,
      };
      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        const chunks = limitedBody(incoming, options.maxRequestBodySize);
        const body = Readable.from(chunks);
        init.body = Readable.toWeb(body);
        init.duplex = "half";
      }
      const request = new Request(url, init);
      const context: RequestContext = { incoming, socket, head, upgraded: false };
      requests.set(request, context);
      const response = await options.fetch(request, server);
      if (context.upgraded) return;
      if (response === undefined) throw new Error("HTTP handler returned no response");
      if (outgoing === undefined && socket) {
        outgoing = new ServerResponse(incoming);
        outgoing.assignSocket(socket);
        outgoing.shouldKeepAlive = false;
      }
      if (outgoing) await sendResponse(response, outgoing, incoming.method);
    } catch (error) {
      if (outgoing === undefined && socket && socket.destroyed === false) {
        outgoing = new ServerResponse(incoming);
        outgoing.assignSocket(socket);
        outgoing.shouldKeepAlive = false;
      }
      if (outgoing && outgoing.headersSent === false && outgoing.destroyed === false) {
        const status = error instanceof BodyLimitError ? 413 : 500;
        const message = status === 413 ? "request body too large" : "internal server error";
        const response = new Response(message, { status });
        await sendResponse(response, outgoing, incoming.method);
      } else {
        outgoing?.destroy();
        socket?.destroy();
      }
    } finally {
      connection?.off("close", abort);
      incoming.off("aborted", abort);
    }
  };

  http.on("request", (request, response) => {
    void handle(request, response).catch(() => response.destroy());
  });
  http.on("upgrade", (request, socket, head) => {
    void handle(request, undefined, socket, head).catch(() => socket.destroy());
  });
  http.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    http.once("error", failed);
    http.listen(options.port, options.hostname, () => {
      http.off("error", failed);
      resolve();
    });
  });
  const address = http.address();
  if (address && typeof address !== "string") server.port = address.port;
  return server;
}
