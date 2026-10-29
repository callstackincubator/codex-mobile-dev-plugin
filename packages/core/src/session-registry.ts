import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";

/** The unguessable ID a tool result hands out for each live session. */
export const sessionIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const SESSION_IDLE_MS = 300000;
const SWEEP_MS = 10000;

export type SessionRegistryOptions<S> = {
  /** Sessions open at once, counting those still opening or closing. */
  limit: number;
  limitMessage: string;
  expiredMessage: string;
  /** Releases a session. A returned promise keeps its slot and key until it settles. */
  stop: (session: S) => void | Promise<void>;
  deviceId: (session: S) => string | undefined;
  /** One live session per key, such as one collector per app. */
  key?: (session: S) => string;
  duplicateMessage?: string;
  /** Runs for every live session on each sweep. */
  sweep?: (session: S) => void;
  /** Names the session in idle-expiry cleanup failures. */
  name: string;
};

type Entry<S> = { session: S; key?: string; expires: number; stopping?: Promise<void> };

/** Throws the one failure, or every failure together. */
export function throwFailures(results: PromiseSettledResult<unknown>[], message: string) {
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

/**
 * Sessions addressed by random IDs, capped, and closed after five idle minutes. Closing is
 * idempotent: a session stays reserved until its stop settles, and every caller shares that stop.
 */
export class SessionRegistry<S> {
  private readonly entries = new Map<string, Entry<S>>();
  private readonly keys = new Set<string>();
  private readonly options: SessionRegistryOptions<S>;
  private readonly timer: NodeJS.Timeout;
  private opening = 0;
  private disposed = false;

  constructor(options: SessionRegistryOptions<S>) {
    this.options = options;
    this.timer = setInterval(() => {
      for (const [id, entry] of this.entries) {
        if (entry.stopping) continue;
        if (entry.expires < Date.now()) this.expire(id);
        else this.options.sweep?.(entry.session);
      }
    }, SWEEP_MS);
    this.timer.unref();
  }

  get closed() { return this.disposed; }

  private reserve(key?: string) {
    if (this.disposed) throw new ExpectedOperationError("session_closed", "The plugin server has closed.");
    if (this.entries.size + this.opening >= this.options.limit) throw new ExpectedOperationError("resource_limit", this.options.limitMessage);
    if (key !== undefined && this.keys.has(key)) throw new ExpectedOperationError("resource_limit", this.options.duplicateMessage ?? this.options.limitMessage);
  }

  private insert(session: S, key?: string) {
    const id = randomBytes(32).toString("hex");
    this.entries.set(id, { session, key, expires: Date.now() + SESSION_IDLE_MS });
    if (key !== undefined) this.keys.add(key);
    return id;
  }

  /** Registers a session that is ready to use. */
  add(session: S): string {
    const key = this.options.key?.(session);
    this.reserve(key);
    return this.insert(session, key);
  }

  /** Holds a slot while `create` runs, and stops a session that finishes after the registry closed. */
  async open(create: () => Promise<S>): Promise<string> {
    this.reserve();
    this.opening++;
    let session: S;
    try { session = await create(); }
    finally { this.opening--; }
    if (this.disposed) {
      await this.options.stop(session);
      throw new ExpectedOperationError("session_closed", "The plugin server has closed.");
    }
    return this.insert(session, this.options.key?.(session));
  }

  /** The session, with its idle expiry renewed. Closing sessions count as expired unless `stopping` allows them. */
  get(id: string, { stopping = false } = {}): S {
    const entry = this.entries.get(id);
    if (entry?.stopping && stopping) return entry.session;
    if (entry === undefined || entry.stopping || entry.expires < Date.now()) {
      if (entry && !entry.stopping) this.expire(id);
      throw new ExpectedOperationError("session_expired", this.options.expiredMessage);
    }
    entry.expires = Date.now() + SESSION_IDLE_MS;
    return entry.session;
  }

  /** Whether `session` is still the live session for `id`. */
  current(id: string, session: S) {
    const entry = this.entries.get(id);
    return entry?.session === session && entry.stopping === undefined;
  }

  private expire(id: string) {
    this.closeSession(id).catch(error => console.error(`${this.options.name} cleanup:`, error));
  }

  closeSession(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) return Promise.resolve();
    if (entry.stopping) return entry.stopping;
    const release = () => {
      if (this.entries.get(id) !== entry) return;
      this.entries.delete(id);
      if (entry.key !== undefined) this.keys.delete(entry.key);
    };
    let stopped: void | Promise<void>;
    try { stopped = this.options.stop(entry.session); }
    catch (error) { release(); return Promise.reject(error); }
    // Synchronous stops release at once, so later lookups already miss the session.
    if (stopped instanceof Promise === false) { release(); return Promise.resolve(); }
    entry.stopping = stopped.finally(release);
    return entry.stopping;
  }

  async closeWhere(matches: (session: S) => boolean) {
    const ids = [...this.entries].filter(([, entry]) => matches(entry.session)).map(([id]) => id);
    throwFailures(await Promise.allSettled(ids.map(id => this.closeSession(id))), `${this.options.name}s failed to close.`);
  }

  closeDevice(deviceId: string) {
    return this.closeWhere(session => this.options.deviceId(session) === deviceId);
  }

  async close() {
    this.disposed = true;
    clearInterval(this.timer);
    await this.closeWhere(() => true);
  }
}
