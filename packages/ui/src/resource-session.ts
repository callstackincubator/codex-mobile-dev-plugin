import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { HostBridge } from "./host-bridge.ts";

type Reader = Pick<HostBridge, "readServerResource">;

/**
 * What a failed close means. `ignore`: idle sessions also expire on the server, so the
 * panel moves on. `retry`: the close rejects and the session stays open until a later
 * close succeeds, so a collector is not left running beside the next one.
 */
export type ClosePolicy = "ignore" | "retry";

/** The text of a resource's JSON content, if it has one. */
export function jsonContent(resource: ReadResourceResult): string | undefined {
  const content = resource.contents.find(item => item.mimeType === "application/json" && "text" in item);
  return content && "text" in content ? content.text : undefined;
}

/** Parses a resource's JSON content with `schema`; content that is missing or does not match throws `invalid()`. */
export function parseJsonContent<T>(resource: ReadResourceResult, schema: z.ZodType<T>, invalid: () => Error): T {
  const text = jsonContent(resource);
  if (text === undefined) throw invalid();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw invalid(); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

export async function readJsonResource<T>(app: Reader, uri: string, schema: z.ZodType<T>, { signal, timeout, invalid }: { signal?: AbortSignal; timeout: number; invalid: () => Error }): Promise<T> {
  return parseJsonContent(await app.readServerResource({ uri }, { signal, timeout }), schema, invalid);
}

/** A session open on the server. Closing aborts its reads and calls the close tool once, as its policy allows. */
export class ResourceSession {
  readonly id: string;
  readonly uri: string;
  readonly abort = new AbortController();
  /** Settles once the server closed the session; under `ignore`, once the attempt finished either way. */
  readonly closed: Promise<void>;
  private settle!: () => void;
  private closing?: Promise<void>;
  private readonly closeTool: (id: string) => Promise<unknown>;
  private readonly policy: ClosePolicy;

  constructor(id: string, uri: string, close: (id: string) => Promise<unknown>, policy: ClosePolicy) {
    this.id = id;
    this.uri = uri;
    this.closeTool = close;
    this.policy = policy;
    this.closed = new Promise(resolve => { this.settle = resolve; });
  }

  close(): Promise<void> {
    this.abort.abort();
    if (this.closing) return this.closing;
    const attempt = this.closeTool(this.id).then(() => {});
    this.closing = this.policy === "ignore"
      ? attempt.catch(() => {}).then(this.settle)
      : attempt.then(this.settle, error => { this.closing = undefined; throw error; });
    return this.closing;
  }
}

export type CursorReadOptions<B> = {
  app: Reader;
  uri: string;
  schema: z.ZodType<B>;
  /** The error for a batch that is missing or malformed. */
  invalid: () => Error;
  /** Where the next read resumes. Without it each read asks the resource for its next batch as is. */
  cursor?: (batch: B) => number;
  signal: AbortSignal;
  timeout: number;
  /** Reading continues while this holds, such as while the epoch that opened the session lasts. */
  active?: () => boolean;
  /** Runs before each read. A signal it returns drops that read when aborted, and the same cursor is read again. */
  beforeRead?: () => Promise<AbortSignal | void>;
  /** Applies one batch; `arrivedAt` is when its resource arrived, before parsing. Returning false ends reading. */
  onBatch(batch: B, arrivedAt: number): boolean | void | Promise<boolean | void>;
};

/** Reads a resource batch after batch, resuming after each batch's cursor. */
export async function readCursorBatches<B>({ app, uri, schema, invalid, cursor, signal, timeout, active = () => true, beforeRead, onBatch }: CursorReadOptions<B>) {
  const address = new URL(uri);
  let after = 0;
  const reading = () => !signal.aborted && active();
  while (reading()) {
    const skip = await beforeRead?.();
    if (!reading()) return;
    if (cursor) address.searchParams.set("after", String(after));
    let resource: ReadResourceResult;
    try { resource = await app.readServerResource({ uri: address.href }, { signal: skip ? AbortSignal.any([signal, skip]) : signal, timeout }); }
    catch (error) {
      if (!signal.aborted && skip?.aborted) continue;
      throw error;
    }
    if (!reading()) return;
    if (skip?.aborted) continue;
    const arrivedAt = performance.now();
    const batch = parseJsonContent(resource, schema, invalid);
    if (cursor) after = cursor(batch);
    if (await onBatch(batch, arrivedAt) === false) return;
  }
}

export type CursorSessionOptions<B, O extends { id: string; uri: string }> = Omit<CursorReadOptions<B>, "uri" | "signal"> & {
  /** Opens the session; its result names the session and the resource its batches come from. */
  open(): Promise<O>;
  close(id: string): Promise<unknown>;
  closePolicy: ClosePolicy;
  /** Ends reading besides the session's own close. */
  signal?: AbortSignal;
  /** Runs once the session is open, before any read. False closes it unread; a throw leaves closing to the caller. */
  opened?(session: ResourceSession, result: O): boolean | void | Promise<boolean | void>;
};

/** Opens a session, reads its batches until the signal, `active` or `onBatch` ends it, and closes it. */
export async function openCursorSession<B, O extends { id: string; uri: string }>({ open, close, closePolicy, signal, opened, ...read }: CursorSessionOptions<B, O>) {
  const result = await open();
  const session = new ResourceSession(result.id, result.uri, close, closePolicy);
  if (await opened?.(session, result) === false) { await session.close(); return; }
  try { await readCursorBatches({ ...read, uri: session.uri, signal: signal ? AbortSignal.any([signal, session.abort.signal]) : session.abort.signal }); }
  finally { await session.close(); }
}

/**
 * A panel's one collector session at a time. Stopping closes it, and a session whose close
 * fails stays current, so the next run closes it before opening another.
 */
export class CollectorSessions {
  epoch = 0;
  running?: Promise<void>;
  private session?: ResourceSession;
  private cleanup: Promise<void> = Promise.resolve();

  /** Settles once earlier stops have; a run started without stopping first waits for it. */
  get settled() { return this.cleanup; }

  /** Makes `session` current until it closes; false when a newer run began meanwhile. */
  adopt(session: ResourceSession, epoch: number) {
    this.session = session;
    void session.closed.then(() => { if (this.session === session) this.session = undefined; });
    return epoch === this.epoch;
  }

  /** Waits for `cleanup`, then closes a session an earlier failed close left open. False once a newer run began. */
  async prepare(epoch: number, cleanup: Promise<void>) {
    await cleanup;
    if (epoch === this.epoch && this.session) await this.session.close();
    return epoch === this.epoch;
  }

  /** Ends the current run and closes its session; rejects if that close fails. */
  stop(): Promise<void> {
    this.epoch++;
    const session = this.session;
    const running = this.running;
    this.running = undefined;
    const closing = session ? session.close() : Promise.resolve();
    const finishing = Promise.allSettled([this.cleanup, closing, running]);
    this.cleanup = finishing.then(() => {});
    return finishing.then(() => closing);
  }
}
