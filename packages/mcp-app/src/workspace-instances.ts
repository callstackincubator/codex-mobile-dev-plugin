import { workspaceInstanceSchema, type WorkspaceInstance } from "@mobile-dev/shared/workspace-instance.ts";
import { z } from "zod";

type Channel = { postMessage(data: unknown): void; close(): void; onmessage: ((event: MessageEvent) => void) | null };
const announcementSchema = z.object({ type: z.enum(["hello", "current"]), key: workspaceInstanceSchema, sender: z.string().uuid() });

/** Keep the newest workspace active within a connector origin and server session. */
export class WorkspaceInstances {
  private channel?: Channel;
  private key?: WorkspaceInstance;
  private closed = false;
  private readonly sender = crypto.randomUUID();
  private readonly superseded: () => void;
  private readonly createChannel: (name: string) => Channel | undefined;

  constructor(superseded: () => void, createChannel = (name: string): Channel | undefined =>
    typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(name)) {
    this.superseded = superseded;
    this.createChannel = createChannel;
  }

  accept(input: unknown) {
    if (this.closed) return false;
    const parsed = workspaceInstanceSchema.safeParse(input);
    if (!parsed.success) return true; // Stored views from earlier releases have no key.
    const key = parsed.data;
    if (this.key?.scope === key.scope && key.sequence < this.key.sequence) return false;
    if (this.key?.scope !== key.scope) {
      this.disconnect();
      try { this.channel = this.createChannel(`mobile-dev-workspace:${key.scope}`); }
      catch { this.channel = undefined; } // Some hosts deny same-origin channels.
      if (this.channel) this.channel.onmessage = event => {
        if (this.closed || !this.key) return;
        const peer = announcementSchema.safeParse(event.data);
        if (!peer.success || peer.data.key.scope !== this.key.scope) return;
        if (peer.data.key.sequence > this.key.sequence || peer.data.key.sequence === this.key.sequence && peer.data.sender > this.sender) {
          this.dispose();
          this.superseded();
        } else if (peer.data.type === "hello") this.announce("current");
      };
    }
    this.key = key;
    this.announce("hello");
    return true;
  }

  private announce(type: "hello" | "current") {
    try { this.channel?.postMessage({ type, key: this.key, sender: this.sender }); }
    catch { this.disconnect(); }
  }

  private disconnect() {
    if (this.channel) { this.channel.onmessage = null; this.channel.close(); this.channel = undefined; }
  }

  dispose() {
    this.closed = true;
    this.disconnect();
  }
}
