/** Long-poll reads waiting for the next change, a timeout or their caller's abort. */
export class Waiters {
  private readonly pending = new Set<() => void>();

  wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        this.pending.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.pending.add(done);
      signal?.addEventListener("abort", done, { once: true });
      if (signal?.aborted) done();
    });
  }

  wake() { for (const done of this.pending) done(); }
}

export type Revision<T> = { revision: number; value: T };
export type RevisionBufferOptions<T> = {
  /** Most entries kept. */
  limit: number;
  /** Keeps entries in time order within `seconds` of the latest, one per time. */
  window?: { seconds: number; time: (value: T) => number };
  /** Sees each entry the buffer drops. */
  evicted?: (entry: Revision<T>) => void;
};

/**
 * Entries numbered by a revision that also advances for status changes, so a reader passes
 * the last revision it saw and waits only when nothing changed since.
 */
export class RevisionBuffer<T> {
  private entries: Revision<T>[] = [];
  private latest = 0;
  private ended = false;
  private readonly waiters = new Waiters();
  private readonly options: RevisionBufferOptions<T>;

  constructor(options: RevisionBufferOptions<T>) { this.options = options; }

  get revision() { return this.latest; }
  get closed() { return this.ended; }
  /** The oldest retained entry's revision. */
  get first() { return this.entries[0]?.revision; }

  append(value: T) {
    if (this.ended) return;
    const window = this.options.window;
    const entry = { revision: ++this.latest, value };
    if (window) {
      const time = window.time(value);
      const latest = Math.max(time, this.entries.length > 0 ? window.time(this.entries.at(-1)!.value) : time);
      this.retain(retained => window.time(retained.value) >= latest - window.seconds && window.time(retained.value) !== time);
      this.entries.push(entry);
      this.entries.sort((a, b) => window.time(a.value) - window.time(b.value));
    } else this.entries.push(entry);
    while (this.entries.length > this.options.limit) this.drop();
    this.waiters.wake();
  }

  private retain(keep: (entry: Revision<T>) => boolean) {
    const kept: Revision<T>[] = [];
    for (const entry of this.entries) {
      if (keep(entry)) kept.push(entry);
      else this.options.evicted?.(entry);
    }
    this.entries = kept;
  }

  /** Drops the oldest entry. */
  drop() {
    const entry = this.entries.shift();
    if (entry) this.options.evicted?.(entry);
  }

  /** Advances the revision for a change outside the entries. */
  bump() {
    if (this.ended) return;
    this.latest++;
    this.waiters.wake();
  }

  /** Wakes readers without a new revision. */
  wake() { if (!this.ended) this.waiters.wake(); }

  close() { this.ended = true; this.waiters.wake(); }

  since(after: number): Revision<T>[] { return this.entries.filter(entry => entry.revision > after); }

  /** Waits up to `ms` for a revision after `after`, unless the buffer closed. */
  async wait(after: number, ms: number, signal?: AbortSignal) {
    if (this.ended || after < this.latest || ms <= 0) return;
    await this.waiters.wait(ms, signal);
  }
}
