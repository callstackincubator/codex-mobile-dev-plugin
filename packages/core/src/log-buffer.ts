import type { LogBatch, LogEntry, LogRecord, LogSourceStatus } from "@mobile-dev/shared/logs.ts";
import { RevisionBuffer, Waiters } from "./revision-buffer.ts";

export class LogBuffer {
  private readonly entries: RevisionBuffer<LogEntry>;
  private bytes = 0;
  private readonly sizes = new Map<number, number>();
  private readonly statuses = new Map<string, LogSourceStatus>();
  private readonly batches = new Waiters();
  private readonly byteLimit: number;

  constructor(limit = 2000, byteLimit = 4 * 1024 * 1024) {
    this.byteLimit = byteLimit;
    this.entries = new RevisionBuffer({ limit, evicted: ({ revision }) => {
      this.bytes -= this.sizes.get(revision) ?? 0; this.sizes.delete(revision);
    } });
  }

  push(record: LogRecord) {
    if (this.entries.closed) return;
    const entry = { ...record, message: record.message.slice(0, 16384), stack: record.stack?.slice(0, 16384), sequence: this.entries.revision + 1 };
    const size = JSON.stringify(entry).length * 2;
    this.sizes.set(entry.sequence, size); this.bytes += size;
    this.entries.append(entry);
    while (this.bytes > this.byteLimit && this.entries.first !== undefined) this.entries.drop();
  }

  status(status: LogSourceStatus) { if (!this.entries.closed) { this.statuses.set(status.source, status); this.entries.wake(); } }
  close() { this.entries.close(); this.batches.wake(); }

  async read(after: number, waitMs = 1000): Promise<LogBatch> {
    await this.entries.wait(after, waitMs);
    // Batch bursts into one MCP read rather than one call for each line.
    if (!this.entries.closed && waitMs > 0 && after < this.entries.revision) await this.batches.wait(75);
    const sequence = this.entries.revision;
    const entries = this.entries.since(after).slice(0, 100).map(entry => entry.value);
    const first = this.entries.first ?? sequence + 1;
    return { entries, cursor: entries.at(-1)?.sequence ?? Math.max(after, sequence), dropped: Math.max(0, first - after - 1), statuses: [...this.statuses.values()] };
  }
}
