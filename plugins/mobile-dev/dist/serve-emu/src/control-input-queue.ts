import type { Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import {
  compileGesture,
  type ControlStep,
  type Gesture,
  type Screen,
} from "./input.ts";

export const DEFAULT_CONTROL_QUEUE_MAX_DEPTH = 128;
export const DEFAULT_CONTROL_QUEUE_MAX_BYTES = 1024 * 1024;

export type ControlInputErrorCode =
  | "control-queue-overloaded"
  | "control-queue-closed"
  | "control-writer-closed"
  | "control-writer-error"
  | "control-dispatch-failed";

export class ControlInputError extends Error {
  constructor(
    readonly code: ControlInputErrorCode,
    message: string,
    readonly meta?: Record<string, number>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ControlInputError";
  }
}

export type ControlInputCompletion = {
  status: "completed" | "coalesced";
};

export type ControlInputHandle = {
  gesture: Gesture;
  completion: Promise<ControlInputCompletion>;
};

export type ControlPacketHandle = {
  completion: Promise<ControlInputCompletion>;
};

export type ControlBinaryWriter = {
  write(packet: Buffer, signal: AbortSignal): Promise<void>;
  close?: (reason: Error) => void;
};

export type ControlInputClock = {
  sleep(ms: number, signal: AbortSignal): Promise<void>;
};

type WriteWaiter = {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
  callbackDone: boolean;
  drained: boolean;
  needsDrain: boolean;
  writeReturned: boolean;
};

function signalError(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new ControlInputError("control-queue-closed", fallback);
}

export class SocketControlWriter implements ControlBinaryWriter {
  #failure: ControlInputError | null = null;
  #waiters = new Set<WriteWaiter>();

  constructor(readonly socket: Socket) {
    socket.on("drain", this.#onDrain);
    socket.on("error", this.#onError);
    socket.on("close", this.#onClose);
    if (socket.destroyed || !socket.writable) {
      this.#failure = new ControlInputError(
        "control-writer-closed",
        "scrcpy control socket is not writable",
      );
    }
  }

  async write(packet: Buffer, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signalError(signal, "control write aborted");
    if (this.#failure) throw this.#failure;

    await new Promise<void>((resolve, reject) => {
      const waiter: WriteWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {},
        callbackDone: false,
        drained: false,
        needsDrain: false,
        writeReturned: false,
      };
      waiter.onAbort = () => {
        if (!this.#waiters.delete(waiter)) return;
        signal.removeEventListener("abort", waiter.onAbort);
        reject(signalError(signal, "control write aborted"));
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.#waiters.add(waiter);

      if (this.#failure) {
        this.#rejectWaiter(waiter, this.#failure);
      } else if (signal.aborted) {
        waiter.onAbort();
      } else {
        try {
          const writable = this.socket.write(packet, (err?: Error | null) => {
            if (err) {
              this.#fail(
                new ControlInputError(
                  "control-writer-error",
                  `scrcpy control write failed: ${err.message}`,
                  undefined,
                  { cause: err },
                ),
              );
              return;
            }
            waiter.callbackDone = true;
            this.#finishWaiterIfReady(waiter);
          });
          waiter.needsDrain = !writable;
          waiter.drained = writable;
          waiter.writeReturned = true;
          this.#finishWaiterIfReady(waiter);
        } catch (err) {
          this.#fail(
            new ControlInputError(
              "control-writer-error",
              `scrcpy control write failed: ${err instanceof Error ? err.message : String(err)}`,
              undefined,
              { cause: err },
            ),
          );
        }
      }
    });
  }

  close(reason: Error): void {
    const failure =
      reason instanceof ControlInputError
        ? reason
        : new ControlInputError(
            "control-writer-closed",
            reason.message,
            undefined,
            { cause: reason },
          );
    this.#fail(failure);
  }

  #onDrain = () => {
    for (const waiter of Array.from(this.#waiters)) {
      waiter.drained = true;
      this.#finishWaiterIfReady(waiter);
    }
  };

  #onError = (err: Error) => {
    this.#fail(
      new ControlInputError(
        "control-writer-error",
        `scrcpy control socket error: ${err.message}`,
        undefined,
        { cause: err },
      ),
    );
  };

  #onClose = () => {
    this.#fail(
      new ControlInputError(
        "control-writer-closed",
        "scrcpy control socket closed",
      ),
    );
  };

  #fail(failure: ControlInputError): void {
    if (!this.#failure) this.#failure = failure;
    for (const waiter of Array.from(this.#waiters)) {
      this.#rejectWaiter(waiter, this.#failure);
    }
  }

  #finishWaiterIfReady(waiter: WriteWaiter): void {
    if (
      !waiter.writeReturned ||
      !waiter.callbackDone ||
      (waiter.needsDrain && !waiter.drained)
    ) {
      return;
    }
    if (!this.#waiters.delete(waiter)) return;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve();
  }

  #rejectWaiter(waiter: WriteWaiter, reason: unknown): void {
    if (!this.#waiters.delete(waiter)) return;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.reject(reason);
  }
}

type CompletionWaiter = {
  status: ControlInputCompletion["status"];
  resolve: (result: ControlInputCompletion) => void;
  reject: (reason: unknown) => void;
};

type QueueEntry = {
  steps: ControlStep[];
  bytes: number;
  gesture: Gesture | null;
  moveKey: string | null;
  coalesceKey: string | null;
  waiters: CompletionWaiter[];
};

export type ControlInputQueueSnapshot = {
  closed: boolean;
  depth: number;
  bytes: number;
  entries: number;
  active: boolean;
  reservedReleases: number;
  maxDepth: number;
  maxBytes: number;
};

export type ControlInputQueueOptions = {
  writer?: ControlBinaryWriter;
  socket?: Socket;
  clock?: ControlInputClock;
  maxDepth?: number;
  maxBytes?: number;
};

const SYSTEM_CLOCK: ControlInputClock = {
  sleep: (ms, signal) => sleep(ms, undefined, { signal }),
};

export class ControlInputQueue {
  readonly #writer: ControlBinaryWriter;
  readonly #clock: ControlInputClock;
  readonly #maxDepth: number;
  readonly #maxBytes: number;
  readonly #controller = new AbortController();
  #pending: QueueEntry[] = [];
  #active: QueueEntry | null = null;
  #depth = 0;
  #bytes = 0;
  #running = false;
  #scheduled = false;
  #closedError: Error | null = null;
  #openPointers = new Set<string>();

  constructor(options: ControlInputQueueOptions) {
    if (Boolean(options.writer) === Boolean(options.socket)) {
      throw new Error("ControlInputQueue requires exactly one writer or socket");
    }
    this.#writer =
      options.writer ?? new SocketControlWriter(options.socket as Socket);
    this.#clock = options.clock ?? SYSTEM_CLOCK;
    this.#maxDepth = positiveInteger(
      options.maxDepth ?? DEFAULT_CONTROL_QUEUE_MAX_DEPTH,
      "maxDepth",
    );
    this.#maxBytes = positiveInteger(
      options.maxBytes ?? DEFAULT_CONTROL_QUEUE_MAX_BYTES,
      "maxBytes",
    );
  }

  enqueue(gesture: Gesture, screen: Screen): ControlInputHandle {
    this.#assertOpen();
    const compiled = compileGesture(gesture, { ...screen });
    const moveKey =
      compiled.gesture.type === "touch" &&
      compiled.gesture.action === "move"
        ? `touch:${compiled.gesture.pointerId ?? 0}`
        : null;
    const pointerKey =
      compiled.gesture.type === "touch"
        ? `touch:${compiled.gesture.pointerId ?? 0}`
        : null;
    let nextReservedReleases = this.#openPointers.size;
    if (
      pointerKey &&
      compiled.gesture.type === "touch" &&
      compiled.gesture.action === "down" &&
      !this.#openPointers.has(pointerKey)
    ) {
      nextReservedReleases++;
    } else if (
      pointerKey &&
      compiled.gesture.type === "touch" &&
      compiled.gesture.action === "up" &&
      this.#openPointers.has(pointerKey)
    ) {
      nextReservedReleases--;
    }
    const waiter = this.#createWaiter();
    const tail = this.#pending.at(-1);

    if (moveKey && tail?.moveKey === moveKey) {
      this.#reserveCoalesced(tail, compiled.bytes);
      const previous = tail.waiters.at(-1);
      if (previous) previous.status = "coalesced";
      tail.steps = compiled.steps;
      tail.bytes = compiled.bytes;
      tail.gesture = compiled.gesture;
      tail.waiters.push(waiter.waiter);
      return { gesture: compiled.gesture, completion: waiter.promise };
    }

    this.#reserveNew(compiled.bytes, nextReservedReleases);
    if (pointerKey && compiled.gesture.type === "touch") {
      if (compiled.gesture.action === "down") {
        this.#openPointers.add(pointerKey);
      } else if (compiled.gesture.action === "up") {
        this.#openPointers.delete(pointerKey);
      }
    }
    this.#pending.push({
      steps: compiled.steps,
      bytes: compiled.bytes,
      gesture: compiled.gesture,
      moveKey,
      coalesceKey: null,
      waiters: [waiter.waiter],
    });
    this.#schedule();
    return { gesture: compiled.gesture, completion: waiter.promise };
  }

  enqueuePacket(
    packet: Buffer,
    options: { coalesceKey?: string } = {},
  ): ControlPacketHandle {
    this.#assertOpen();
    if (!Buffer.isBuffer(packet) || packet.length === 0) {
      throw new Error("control packet must be a non-empty Buffer");
    }
    const bytes = packet.length;
    const coalesceKey = options.coalesceKey ?? null;
    const waiter = this.#createWaiter();
    const tail = this.#pending.at(-1);

    if (coalesceKey && tail?.coalesceKey === coalesceKey) {
      this.#reserveCoalesced(tail, bytes);
      const previous = tail.waiters.at(-1);
      if (previous) previous.status = "coalesced";
      tail.steps = [{ delayMs: 0, packet: Buffer.from(packet) }];
      tail.bytes = bytes;
      tail.waiters.push(waiter.waiter);
      return { completion: waiter.promise };
    }

    this.#reserveNew(bytes);
    this.#pending.push({
      steps: [{ delayMs: 0, packet: Buffer.from(packet) }],
      bytes,
      gesture: null,
      moveKey: null,
      coalesceKey,
      waiters: [waiter.waiter],
    });
    this.#schedule();
    return { completion: waiter.promise };
  }

  close(reason: Error = new Error("control input queue closed")): void {
    if (this.#closedError) return;
    this.#closedError =
      reason instanceof ControlInputError
        ? reason
        : new ControlInputError(
            "control-queue-closed",
            reason.message,
            undefined,
            { cause: reason },
          );
    this.#controller.abort(this.#closedError);
    this.#writer.close?.(this.#closedError);
    this.#openPointers.clear();

    const pending = this.#pending;
    this.#pending = [];
    for (const entry of pending) {
      this.#rejectEntry(entry, this.#closedError);
      this.#release(entry);
    }
  }

  snapshot(): ControlInputQueueSnapshot {
    return {
      closed: this.#closedError !== null,
      depth: this.#depth,
      bytes: this.#bytes,
      entries: this.#pending.length + (this.#active ? 1 : 0),
      active: this.#active !== null,
      reservedReleases: this.#openPointers.size,
      maxDepth: this.#maxDepth,
      maxBytes: this.#maxBytes,
    };
  }

  assertOpen(): void {
    this.#assertOpen();
  }

  #assertOpen(): void {
    if (this.#closedError) throw this.#closedError;
  }

  #createWaiter(): {
    waiter: CompletionWaiter;
    promise: Promise<ControlInputCompletion>;
  } {
    let resolve!: (result: ControlInputCompletion) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<ControlInputCompletion>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      promise,
      waiter: { status: "completed", resolve, reject },
    };
  }

  #reserveNew(
    bytes: number,
    reservedReleases = this.#openPointers.size,
  ): void {
    this.#assertCapacity(
      this.#depth + 1,
      this.#bytes + bytes,
      reservedReleases,
    );
    this.#depth++;
    this.#bytes += bytes;
  }

  #reserveCoalesced(entry: QueueEntry, bytes: number): void {
    const nextBytes = this.#bytes - entry.bytes + bytes;
    this.#assertCapacity(
      this.#depth + 1,
      nextBytes,
      this.#openPointers.size,
    );
    this.#depth++;
    this.#bytes = nextBytes;
  }

  #assertCapacity(
    depth: number,
    bytes: number,
    reservedReleases: number,
  ): void {
    if (
      depth + reservedReleases <= this.#maxDepth &&
      bytes + reservedReleases * 32 <= this.#maxBytes
    ) {
      return;
    }
    throw new ControlInputError(
      "control-queue-overloaded",
      "scrcpy control input queue is full",
      {
        depth: this.#depth,
        bytes: this.#bytes,
        maxDepth: this.#maxDepth,
        maxBytes: this.#maxBytes,
      },
    );
  }

  #schedule(): void {
    if (this.#scheduled || this.#running || this.#closedError) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.#pump();
    });
  }

  async #pump(): Promise<void> {
    if (this.#running || this.#closedError) return;
    this.#running = true;
    try {
      while (!this.#closedError && this.#pending.length > 0) {
        const entry = this.#pending.shift()!;
        this.#active = entry;
        try {
          await this.#dispatch(entry.steps);
          if (this.#controller.signal.aborted) {
            throw signalError(
              this.#controller.signal,
              "control input queue closed",
            );
          }
          for (const waiter of entry.waiters) {
            waiter.resolve({ status: waiter.status });
          }
        } catch (err) {
          const failure =
            this.#controller.signal.aborted
              ? signalError(
                  this.#controller.signal,
                  "control input queue closed",
                )
              : err instanceof ControlInputError
              ? err
              : new ControlInputError(
                  "control-dispatch-failed",
                  `scrcpy control dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
                  undefined,
                  { cause: err },
                );
          this.#rejectEntry(entry, failure);
          this.#release(entry);
          this.#active = null;
          this.close(failure);
          return;
        }
        this.#release(entry);
        this.#active = null;
      }
    } finally {
      this.#running = false;
      if (!this.#closedError && this.#pending.length > 0) this.#schedule();
    }
  }

  async #dispatch(steps: ControlStep[]): Promise<void> {
    for (const step of steps) {
      if (this.#controller.signal.aborted) {
        throw signalError(
          this.#controller.signal,
          "control input queue closed",
        );
      }
      if (step.delayMs > 0) {
        await this.#clock.sleep(step.delayMs, this.#controller.signal);
      }
      if (this.#controller.signal.aborted) {
        throw signalError(
          this.#controller.signal,
          "control input queue closed",
        );
      }
      await this.#writer.write(step.packet, this.#controller.signal);
      if (this.#controller.signal.aborted) {
        throw signalError(
          this.#controller.signal,
          "control input queue closed",
        );
      }
    }
  }

  #rejectEntry(entry: QueueEntry, reason: unknown): void {
    for (const waiter of entry.waiters) waiter.reject(reason);
  }

  #release(entry: QueueEntry): void {
    this.#depth -= entry.waiters.length;
    this.#bytes -= entry.bytes;
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
