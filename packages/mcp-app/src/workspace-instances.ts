import { workspaceInstanceSchema, type WorkspaceInstance } from "@mobile-dev/shared/workspace-instance.ts";

type Channel = { postMessage(data: unknown): void; close(): void; onmessage: ((event: MessageEvent) => void) | null };

/** Keep the newest workspace active within a connector origin and server session. */
export class WorkspaceInstances {
  private channel?: Channel;
  private key?: WorkspaceInstance;
  private closed = false;
  private superseded: () => void;
  private createChannel: (name: string) => Channel | undefined;

  constructor(superseded: () => void, createChannel = (name: string): Channel | undefined =>
    typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(name)) {
    this.superseded = superseded;
    this.createChannel = createChannel;
  }

  accept(input: unknown) {
    if (this.closed) return;
    const parsed = workspaceInstanceSchema.safeParse(input);
    if (!parsed.success) return; // Stored views from earlier releases have no key.
    const key = parsed.data;
    if (this.key?.scope !== key.scope) {
      this.channel?.close();
      try { this.channel = this.createChannel(`mobile-dev-workspace:${key.scope}`); }
      catch { this.channel = undefined; } // Some hosts deny same-origin channels.
      if (this.channel) this.channel.onmessage = event => {
        if (this.closed || !this.key) return;
        const peer = workspaceInstanceSchema.safeParse(event.data?.key);
        if (!peer.success || peer.data.scope !== this.key.scope) return;
        if (event.data.type !== "hello" && event.data.type !== "current") return;
        if (peer.data.createdAt > this.key.createdAt || peer.data.createdAt === this.key.createdAt && peer.data.sequence > this.key.sequence) {
          this.dispose();
          this.superseded();
        } else if (event.data.type === "hello") {
          this.channel?.postMessage({ type: "current", key: this.key });
        }
      };
    }
    this.key = key;
    this.channel?.postMessage({ type: "hello", key });
  }

  dispose() {
    this.closed = true;
    if (this.channel) { this.channel.onmessage = null; this.channel.close(); this.channel = undefined; }
  }
}
