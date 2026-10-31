import type { TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ConnectOptions = {
  /** The client's name. The server reads it as the host's name, which telemetry records. */
  name?: string;
  capabilities?: ClientOptions["capabilities"];
  /** Runs on the server's end before it connects, for example to install trace propagation or fail sends. */
  prepare?: (serverTransport: InMemoryTransport) => void;
  /** Runs on the client before it connects, for example to answer the server's requests. */
  setup?: (client: Client) => void;
};

/** Connects an in-memory client to `server`. The client and server close after the test. */
export async function connectClient(t: TestContext, server: McpServer, { name = "test", capabilities, prepare, setup }: ConnectOptions = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  prepare?.(serverTransport);
  const client = new Client({ name, version: "1" }, capabilities ? { capabilities } : undefined);
  setup?.(client);
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** A server with the tools `register` adds, and a client connected to it. Both close after the test. */
export async function serveTools(t: TestContext, register: (server: McpServer) => void, options?: ConnectOptions) {
  const server = new McpServer({ name: "test", version: "1" });
  register(server);
  const client = await connectClient(t, server, options);
  return { server, client };
}
