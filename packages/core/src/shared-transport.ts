import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode, isInitializeRequest, isInitializedNotification, isJSONRPCErrorResponse, isJSONRPCNotification, isJSONRPCRequest, isJSONRPCResultResponse,
  type InitializeResult, type JSONRPCMessage, type MessageExtraInfo, type RequestId,
} from "@modelcontextprotocol/sdk/types.js";

// Requests from other connections reach the server under IDs the host never uses.
const SHARED_ID = "mobile-dev-shared-";

/**
 * The server's transport: the host's connection, plus others that share the same
 * tools, resources and device state, such as a browser page showing the panel.
 *
 * Only the host initializes the server, so the client capabilities the tools see
 * stay the host's; another connection receives the host's negotiated result.
 * Its request IDs are renamed on the way in and restored on the way out. The
 * server's own requests and notifications go to the host unless they belong to a
 * request from another connection.
 */
export class SharedTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private hostInitialize?: RequestId;
  private initialized?: InitializeResult;
  private readonly connections = new Set<Transport>();
  private readonly pending = new Map<string, { connection: Transport; id: RequestId }>();
  private nextId = 0;
  private readonly host: Transport;

  constructor(host: Transport) { this.host = host; }

  get sessionId() { return this.host.sessionId; }
  setProtocolVersion = (version: string) => this.host.setProtocolVersion?.(version);

  async start() {
    this.host.onmessage = (message, extra) => {
      if (isJSONRPCRequest(message) && isInitializeRequest(message)) this.hostInitialize = message.id;
      this.onmessage?.(message, extra);
    };
    this.host.onerror = error => this.onerror?.(error);
    this.host.onclose = () => {
      void this.closeConnections();
      this.onclose?.();
    };
    await this.host.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      const id = message.id === undefined ? undefined : String(message.id);
      const request = id === undefined ? undefined : this.pending.get(id);
      if (request) {
        this.pending.delete(id!);
        return request.connection.send({ ...message, id: request.id });
      }
      // The connection closed or cancelled the request.
      if (id?.startsWith(SHARED_ID)) return;
      if (message.id === this.hostInitialize && isJSONRPCResultResponse(message)) this.initialized = message.result as InitializeResult;
    } else if (options?.relatedRequestId !== undefined) {
      const request = this.pending.get(String(options.relatedRequestId));
      if (request) return request.connection.send(message, { ...options, relatedRequestId: request.id });
    }
    return this.host.send(message, options);
  }

  /**
   * Starts a connection and routes its messages to the server until it closes.
   * Closing it cancels the requests it left unanswered.
   */
  async attach(connection: Transport) {
    const closed = connection.onclose;
    connection.onmessage = (message, extra) => this.receive(connection, message, extra);
    connection.onclose = () => {
      this.detach(connection);
      closed?.();
    };
    this.connections.add(connection);
    await connection.start();
  }

  async close() {
    await this.closeConnections();
    await this.host.close();
  }

  private receive(connection: Transport, message: JSONRPCMessage, extra?: MessageExtraInfo) {
    if (isJSONRPCRequest(message)) {
      if (isInitializeRequest(message)) {
        const reply: JSONRPCMessage = this.initialized
          ? { jsonrpc: "2.0", id: message.id, result: this.initialized }
          : { jsonrpc: "2.0", id: message.id, error: { code: ErrorCode.InvalidRequest, message: "The host has not connected to Mobile Dev yet." } };
        void connection.send(reply).catch(error => this.onerror?.(error));
        return;
      }
      const id = `${SHARED_ID}${++this.nextId}`;
      this.pending.set(id, { connection, id: message.id });
      this.onmessage?.({ ...message, id }, extra);
      return;
    }
    if (isJSONRPCNotification(message)) {
      if (isInitializedNotification(message)) return;
      if (message.method === "notifications/cancelled") {
        const id = this.find(connection, message.params?.requestId as RequestId | undefined);
        if (id === undefined) return;
        this.pending.delete(id);
        this.onmessage?.({ ...message, params: { ...message.params, requestId: id } }, extra);
        return;
      }
    }
    // Other notifications, and answers to the server's requests sent over this connection.
    this.onmessage?.(message, extra);
  }

  private find(connection: Transport, id: RequestId | undefined) {
    for (const [shared, request] of this.pending) if (request.connection === connection && request.id === id) return shared;
  }

  private detach(connection: Transport) {
    if (!this.connections.delete(connection)) return;
    for (const [id, request] of this.pending) {
      if (request.connection !== connection) continue;
      this.pending.delete(id);
      this.onmessage?.({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "The connection closed." } });
    }
  }

  private async closeConnections() {
    await Promise.allSettled([...this.connections].map(connection => connection.close()));
  }
}
