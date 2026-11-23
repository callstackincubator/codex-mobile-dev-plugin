import { J as Transport, er as JSONRPCMessage } from "./mcp-BCJHyo7l.mjs";
import { c as McpServerFactory } from "./createMcpHandler-DzlXH0KL.mjs";
import { Readable, Writable } from "node:stream";

//#region src/server/serveStdio.d.ts

/** Options for {@linkcode serveStdio}. */
interface ServeStdioOptions {
  /**
   * How a 2025-era opening (an `initialize` request, or any claim-less
   * message) is handled:
   *
   * - `'serve'` (default) — the connection is pinned to a 2025-era instance
   *   from the same factory and served exactly as a hand-wired stdio server
   *   serves it today.
   * - `'reject'` — the opening request is answered with the
   *   unsupported-protocol-version error naming the supported modern
   *   revisions (claim-less notifications are dropped); the connection
   *   stays open for a modern opening.
   */
  legacy?: 'serve' | 'reject';
  /**
   * Bring your own transport (for example a `StdioServerTransport`
   * constructed over a Unix domain socket or TCP stream, per the stdio
   * binding's custom-transport guidance). Defaults to a
   * {@linkcode StdioServerTransport} over the current process's stdio. The
   * entry owns the transport: it starts it, receives every inbound message,
   * and closes it when the connection ends.
   */
  transport?: Transport;
  /** Callback for out-of-band errors (reporting only; it never alters what is written to the wire). */
  onerror?: (error: Error) => void;
  /**
   * Reject a new `subscriptions/listen` with `-32603` 'Subscription limit
   * reached' (in-band, before the ack) when this many subscriptions are
   * already open on this connection.
   * @default 1024
   */
  maxSubscriptions?: number;
}
/** The handle returned by {@linkcode serveStdio}. */
interface StdioServerHandle {
  /** Tears the connection down: closes the pinned instance (if any) and the underlying transport. */
  close(): Promise<void>;
}
/**
 * Serves MCP over stdio from a server factory, owning the era decision for
 * the connection: the opening exchange selects the era, ONE instance from the
 * factory is pinned for the connection lifetime, and everything after passes
 * straight through to it. See the module documentation for the opening rules.
 *
 * ```ts
 * import { serveStdio } from '@modelcontextprotocol/server/stdio';
 *
 * serveStdio(() => {
 *     const server = new McpServer({ name: 'my-server', version: '1.0.0' }, { capabilities: { tools: {} } });
 *     // register tools/resources/prompts once — the same factory serves both eras
 *     return server;
 * });
 * ```
 */
declare function serveStdio(factory: McpServerFactory, options?: ServeStdioOptions): StdioServerHandle;
//#endregion
//#region src/server/stdio.d.ts
/**
 * Server transport for stdio: this communicates with an MCP client by reading from the current process' `stdin` and writing to `stdout`.
 *
 * This transport is only available in Node.js environments.
 *
 * When the client closes its end of the pipe (stdin reaches end-of-file), the transport
 * closes itself and fires `onclose`, per the MCP stdio binding's guidance that servers
 * should exit promptly when their standard input is closed. A server that holds no other
 * keep-alive handles will then exit naturally. Requests still in flight when stdin ends are
 * aborted and not answered; a client that expects responses keeps stdin open until it has
 * read them.
 *
 * @example
 * ```ts source="./stdio.examples.ts#StdioServerTransport_basicUsage"
 * const server = new McpServer({ name: 'my-server', version: '1.0.0' });
 * const transport = new StdioServerTransport();
 * await server.connect(transport);
 * ```
 */
declare class StdioServerTransport implements Transport {
  private _stdin;
  private _stdout;
  private _readBuffer;
  private _started;
  private _closed;
  constructor(_stdin?: Readable, _stdout?: Writable, options?: {
    /**
     * Maximum size of the read buffer in bytes. If a single message exceeds
     * this size the transport will emit an error and close.
     *
     * Defaults to 10 MB.
     */
    maxBufferSize?: number;
  });
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  _ondata: (chunk: Buffer) => void;
  _onerror: (error: Error) => void;
  _onstdouterror: (error: Error) => void;
  _onstdinclose: () => void;
  /**
   * Starts listening for messages on `stdin`.
   */
  start(): Promise<void>;
  private processReadBuffer;
  close(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
}
//#endregion
export { type ServeStdioOptions, type StdioServerHandle, StdioServerTransport, serveStdio };
//# sourceMappingURL=stdio.d.mts.map