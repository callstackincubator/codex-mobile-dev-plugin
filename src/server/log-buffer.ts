import type { LogBatch, LogEntry, LogRecord, LogSourceStatus } from "../shared/logs.ts";

export class LogBuffer {
  private entries: LogEntry[] = [];
  private sequence = 0;
  private bytes = 0;
  private readonly sizes = new Map<number, number>();
  private readonly statuses = new Map<string, LogSourceStatus>();
  private readonly waiters = new Set<() => void>();
  private readonly batches = new Set<() => void>();
  private closed = false;
  private readonly limit: number;
  private readonly byteLimit: number;

  constructor(limit = 2000, byteLimit = 4 * 1024 * 1024) { this.limit = limit; this.byteLimit = byteLimit; }

  push(record: LogRecord) {
    if (this.closed) return;
    const entry = { ...record, message: record.message.slice(0, 16384), stack: record.stack?.slice(0, 16384), sequence: ++this.sequence };
    const size = JSON.stringify(entry).length * 2;
    this.entries.push(entry); this.sizes.set(entry.sequence, size); this.bytes += size;
    while (this.entries.length > this.limit || this.bytes > this.byteLimit) {
      const old = this.entries.shift()!;
      this.bytes -= this.sizes.get(old.sequence) ?? 0; this.sizes.delete(old.sequence);
    }
    this.notify();
  }

  status(status: LogSourceStatus) { if (!this.closed) { this.statuses.set(status.source, status); this.notify(); } }
  private notify() { for (const resolve of this.waiters) resolve(); this.waiters.clear(); }
  close() { this.closed = true; this.notify(); for (const resolve of this.batches) resolve(); this.batches.clear(); }

  async read(after: number, waitMs = 1000): Promise<LogBatch> {
    if (!this.closed && after >= this.sequence && waitMs > 0) await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.waiters.delete(done); resolve(); };
      const timer = setTimeout(done, waitMs);
      this.waiters.add(done);
    });
    // Batch bursts into one MCP read rather than one call for each line.
    if (!this.closed && waitMs > 0 && after < this.sequence) await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.batches.delete(done); resolve(); };
      const timer = setTimeout(done, 75);
      this.batches.add(done);
    });
    const entries = this.entries.filter(entry => entry.sequence > after).slice(0, 100);
    const first = this.entries[0]?.sequence ?? this.sequence + 1;
    return { entries, cursor: entries.at(-1)?.sequence ?? Math.max(after, this.sequence), dropped: Math.max(0, first - after - 1), statuses: [...this.statuses.values()] };
  }
}
