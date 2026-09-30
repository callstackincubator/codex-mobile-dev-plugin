import type { z } from "zod";
import type { streamMessageSchema } from "../shared/protocol.ts";

export type StreamMessage = z.infer<typeof streamMessageSchema>;

export class StreamInput {
  private readonly queued: StreamMessage[] = [];
  private sending?: Promise<void>;
  private stopped = false;
  private accepting = true;
  private readonly deliver: (messages: StreamMessage[]) => Promise<void>;
  private readonly failed: (error: unknown) => void;

  constructor(deliver: (messages: StreamMessage[]) => Promise<void>, failed: (error: unknown) => void) {
    this.deliver = deliver;
    this.failed = failed;
  }

  send(message: StreamMessage) {
    if (this.accepting === false) return;
    const last = this.queued.at(-1);
    if (message.type === "touch1-move" && last?.type === "touch1-move") this.queued[this.queued.length - 1] = message;
    else this.queued.push(message);
    if (this.queued.length > 64) {
      this.close();
      this.failed(new Error("Simulator input cannot keep up. Reconnect before continuing."));
      return;
    }
    void this.flush();
  }

  flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = this.drain().catch(error => {
      if (this.stopped) return;
      this.close();
      this.failed(error);
    }).finally(() => {
      this.sending = undefined;
      if (this.stopped === false && this.queued.length > 0) void this.flush();
    });
    return this.sending;
  }

  private async drain() {
    while (this.stopped === false && this.queued.length > 0) {
      const batch = this.queued.splice(0, 64);
      await this.deliver(batch);
    }
  }

  async finish() {
    this.accepting = false;
    await this.flush();
    this.close();
  }

  clear() { this.queued.length = 0; }

  close() { this.accepting = false; this.stopped = true; this.queued.length = 0; }
}
