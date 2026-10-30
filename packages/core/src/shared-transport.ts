import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode, isInitializeRequest, isInitializedNotification, isJSONRPCErrorResponse, isJSONRPCNotification, isJSONRPCRequest, isJSONRPCResultResponse,
  type InitializeResult, type JSONRPCMessage, type MessageExtraInfo, type RequestId,
} from "@modelcontextprotocol/sdk/types.js";

type PendingRequest = { connection: Transport; id: RequestId; initialize: boolean };

/**
 * Shares tools and device state across the chat connection and browser panels.
 * Only the chat initializes the server; panels receive its negotiated result.
 * Every incoming request gets a private ID, including requests from the chat.
 */
export class SharedTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private initialized?: InitializeResult;
  private readonly connections = new Set<Transport>();
  private readonly ready = new Set<Transport>();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly serverRequests = new Map<RequestId, Transport>();
  private nextId = 0;
  private closed = false;
  private readonly host: Transport;

  constructor(host: Transport) { this.host = host; }

  get sessionId() { return this.host.sessionId; }
  setProtocolVersion = (version: string) => this.host.setProtocolVersion?.(version);

  async start() {
    this.host.onmessage = (message, extra) => this.receive(this.host, message, extra);
    this.host.onerror = error => this.onerror?.(error);
    this.host.onclose = () => {
      this.closed = true;
      this.detach(this.host);
      void this.closeConnections();
      this.onclose?.();
    };
    await this.host.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      const request = message.id === undefined ? undefined : this.pending.get(message.id);
      // A cancelled request or a closed connection no longer owns a response.
      if (request === undefined) return;
      this.pending.delete(message.id!);
      if (request.initialize && isJSONRPCResultResponse(message)) {
        this.initialized = message.result as InitializeResult;
      }
      return request.connection.send({ ...message, id: request.id });
    }

    let connection = this.host;
    let relatedRequestId = options?.relatedRequestId;
    if (relatedRequestId !== undefined) {
      const request = this.pending.get(relatedRequestId);
      if (request === undefined) return;
      connection = request.connection;
      relatedRequestId = request.id;
    }
    if (isJSONRPCRequest(message)) this.serverRequests.set(message.id, connection);
    if (isJSONRPCNotification(message) && message.method === "notifications/cancelled") {
      const id = message.params?.requestId as RequestId;
      const owner = this.serverRequests.get(id);
      if (owner === undefined) return;
      connection = owner;
      this.serverRequests.delete(id);
    }
    try {
      await connection.send(message, { ...options, relatedRequestId });
    } catch (error) {
      if (isJSONRPCRequest(message)) this.serverRequests.delete(message.id);
      throw error;
    }
  }

  /** Closing a panel cancels only the requests that connection owns. */
  async attach(connection: Transport) {
    if (this.closed) throw new Error("Mobile Dev's chat connection has closed.");
    const closed = connection.onclose;
    connection.onmessage = (message, extra) => this.receive(connection, message, extra);
    connection.onclose = () => {
      this.detach(connection);
      closed?.();
    };
    connection.onerror = error => this.onerror?.(error);
    this.connections.add(connection);
    try { await connection.start(); }
    catch (error) { this.detach(connection); throw error; }
  }

  async close() {
    this.closed = true;
    await this.closeConnections();
    await this.host.close();
  }

  private receive(connection: Transport, message: JSONRPCMessage, extra?: MessageExtraInfo) {
    if (this.closed) return;
    if (connection !== this.host && this.connections.has(connection) === false) return;
    if (isJSONRPCRequest(message)) {
      const initialize = isInitializeRequest(message);
      if (connection !== this.host) {
        if (initialize) {
          if (this.initialized) this.ready.add(connection);
          const reply: JSONRPCMessage = this.initialized
            ? { jsonrpc: "2.0", id: message.id, result: this.initialized }
            : { jsonrpc: "2.0", id: message.id, error: { code: ErrorCode.InvalidRequest, message: "The host has not connected to Mobile Dev yet." } };
          void connection.send(reply).catch(error => this.onerror?.(error));
          return;
        }
        if (this.ready.has(connection) === false) return;
      }
      const id = `mobile-dev-shared-${++this.nextId}`;
      this.pending.set(id, { connection, id: message.id, initialize });
      this.onmessage?.({ ...message, id }, extra);
      return;
    }
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      const id = message.id;
      if (id === undefined || this.serverRequests.get(id) !== connection) return;
      this.serverRequests.delete(id);
      this.onmessage?.(message, extra);
      return;
    }
    if (isJSONRPCNotification(message)) {
      if (connection !== this.host && isInitializedNotification(message)) return;
      if (message.method === "notifications/cancelled") {
        const requestId = message.params?.requestId as RequestId | undefined;
        const id = this.find(connection, requestId);
        if (id === undefined) return;
        this.pending.delete(id);
        this.onmessage?.({ ...message, params: { ...message.params, requestId: id } }, extra);
        return;
      }
    }
    if (connection === this.host || this.ready.has(connection)) this.onmessage?.(message, extra);
  }

  private find(connection: Transport, id: RequestId | undefined) {
    for (const [shared, request] of this.pending) {
      if (request.connection === connection && request.id === id) return shared;
    }
  }

  private detach(connection: Transport) {
    if (connection !== this.host && this.connections.delete(connection) === false) return;
    this.ready.delete(connection);
    for (const [id, request] of this.pending) {
      if (request.connection !== connection) continue;
      this.pending.delete(id);
      this.onmessage?.({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "The connection closed." } });
    }
    for (const [id, owner] of this.serverRequests) {
      if (owner !== connection) continue;
      this.serverRequests.delete(id);
      this.onmessage?.({ jsonrpc: "2.0", id, error: { code: ErrorCode.InternalError, message: "The connection closed." } });
    }
  }

  private async closeConnections() {
    const closing = Array.from(this.connections, connection => connection.close());
    await Promise.allSettled(closing);
  }
}
