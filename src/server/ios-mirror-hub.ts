import type { IosVideoBatch } from "../shared/ios-video.ts";
import { IosMirrorInputBusyError } from "../shared/ios-mirror-errors.ts";
import type { IosCapture, NativeCapture, NativeTouchSample } from "./ios-native-capture.ts";

type Subscriber = {
  frames: IosVideoBatch["frames"]; bytes: number; generation: number; dropped: number;
  waitingKey: boolean; delivered?: number; closed: boolean; wake?: () => void; reading: boolean;
};
type Device = {
  capture: NativeCapture; subscribers: Set<Subscriber>; generation?: number; keyRequested: boolean;
  configuration?: IosVideoBatch["configuration"]; sequence: number; dropped: number;
  closed: boolean; failure?: Error; reader?: Promise<void>; input: Promise<void>;
  pointer?: { owner: Subscriber; sample: NativeTouchSample; generation: number };
};
export type MirrorHubState = { captures: number; subscribers: number; dropped: number };

export class IosMirrorHub {
  private readonly devices = new Map<string, Device>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly openNative: (udid: string) => Promise<NativeCapture>;
  private readonly changed: (state: MirrorHubState) => void;
  private readonly failed: (error: Error) => void;
  private disposed = false;
  private opening = 0;
  private dropped = 0;

  constructor(open: (udid: string) => Promise<NativeCapture>, changed = (_state: MirrorHubState) => {}, failed = (_error: Error) => {}) {
    this.openNative = open;
    this.changed = changed;
    this.failed = failed;
  }

  private async exclusive<T>(udid: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(udid) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(() => {}, () => {});
    this.operations.set(udid, settled);
    try { return await result; }
    finally { if (this.operations.get(udid) === settled) this.operations.delete(udid); }
  }

  private report() {
    let subscribers = 0;
    for (const device of this.devices.values()) subscribers += device.subscribers.size;
    this.changed({ captures: this.devices.size, subscribers, dropped: this.dropped });
  }

  async open(udid: string): Promise<IosCapture> {
    return this.exclusive(udid, async () => {
      if (this.disposed) throw new Error("The shared iOS capture service has closed.");
      let device = this.devices.get(udid);
      if (device === undefined) {
        if (this.devices.size + this.opening >= 4) throw new Error("Too many physical device streams. Close another panel first.");
        this.opening++;
        let capture: NativeCapture;
        try { capture = await this.openNative(udid); }
        finally { this.opening--; }
        if (this.disposed) { await capture.close(); throw new Error("The shared iOS capture service has closed."); }
        device = { capture, subscribers: new Set(), sequence: 0, dropped: 0, closed: false, keyRequested: false, input: Promise.resolve() };
        this.devices.set(udid, device);
      }
      if (device.failure) throw device.failure;
      if (device.subscribers.size >= 32) throw new Error("Too many panels are mirroring this iPhone.");
      const subscriber: Subscriber = { frames: [], bytes: 0, generation: 0, dropped: 0, waitingKey: true, closed: false, reading: false };
      const shared = device;
      shared.subscribers.add(subscriber);
      // Joining requires a decodable keyframe; the hardware stream remains open.
      if (shared.reader) this.requestKeyframe(shared);
      else shared.reader = this.pump(shared);
      this.report();
      return {
        read: () => this.read(shared, subscriber),
        touch: (samples, generation) => this.touch(shared, subscriber, samples, generation),
        reset: () => this.resetSubscriber(shared, subscriber),
        close: () => this.exclusive(udid, () => this.unsubscribe(udid, shared, subscriber)),
      };
    });
  }

  private check(device: Device, subscriber: Subscriber) {
    if (subscriber.closed || device.closed) throw new Error("The shared physical iOS stream closed.");
    if (device.failure) throw device.failure;
  }

  private invalidate(subscriber: Subscriber) {
    subscriber.generation++;
    subscriber.delivered = undefined;
    subscriber.frames = [];
    subscriber.bytes = 0;
    subscriber.waitingKey = true;
  }

  private requestKeyframe(device: Device) {
    if (device.keyRequested) return;
    device.keyRequested = true;
    device.capture.requestKeyframe();
  }

  private async resetSubscriber(device: Device, subscriber: Subscriber) {
    this.check(device, subscriber);
    this.invalidate(subscriber);
    await this.releasePointer(device, subscriber);
    this.requestKeyframe(device);
  }

  private releasePointer(device: Device, subscriber: Subscriber) {
    const releasing = device.input.then(async () => {
      if (device.pointer?.owner !== subscriber) return;
      const pointer = device.pointer;
      device.pointer = undefined;
      await device.capture.touch([{ ...pointer.sample, phase: 2 }], pointer.generation);
    });
    device.input = releasing.catch(() => {});
    return releasing;
  }

  private async pump(device: Device) {
    try {
      while (device.closed === false) {
        const batch = await device.capture.read();
        if (device.closed) break;
        if (device.generation !== batch.generation) {
          for (const subscriber of device.subscribers) this.invalidate(subscriber);
          device.pointer = undefined;
        }
        device.generation = batch.generation;
        if (batch.configuration) {
          const { description, ...configuration } = batch.configuration;
          const encoded = description.toString("base64");
          device.configuration = { ...configuration, description: encoded };
        }
        const nativeDropped = Math.max(0, batch.dropped - device.dropped);
        device.dropped = batch.dropped;
        for (const subscriber of device.subscribers) subscriber.dropped += nativeDropped;
        for (const frame of batch.frames) {
          if (frame.key) device.keyRequested = false;
          const encoded = frame.data.toString("base64");
          const delivered = { sequence: ++device.sequence, timestamp: frame.timestamp, key: frame.key, data: encoded };
          for (const subscriber of device.subscribers) {
            if (subscriber.frames.length >= 8 || subscriber.bytes + frame.data.length > 4 * 1024 * 1024) {
              const dropped = subscriber.frames.length + 1;
              subscriber.dropped += dropped;
              this.dropped += dropped;
              this.invalidate(subscriber);
            }
            if (subscriber.waitingKey && frame.key === false) continue;
            if (frame.data.length > 4 * 1024 * 1024) continue;
            subscriber.waitingKey = false;
            subscriber.frames.push(delivered);
            subscriber.bytes += frame.data.length;
          }
        }
        for (const subscriber of device.subscribers) subscriber.wake?.();
        // Yield even if a native read resolves immediately after draining its queue.
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    } catch (error) {
      if (device.closed) return;
      const failure = error instanceof Error ? error : new Error("Shared physical iOS capture failed.");
      device.failure = failure;
      for (const subscriber of device.subscribers) subscriber.wake?.();
      this.failed(failure);
    }
  }

  private async read(device: Device, subscriber: Subscriber): Promise<IosVideoBatch> {
    this.check(device, subscriber);
    if (subscriber.reading) throw new Error("A physical device video read is already pending.");
    subscriber.reading = true;
    try {
      if (subscriber.waitingKey) this.requestKeyframe(device);
      if (subscriber.frames.length === 0) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1000);
          subscriber.wake = () => { clearTimeout(timer); resolve(); };
        });
      }
      this.check(device, subscriber);
      const frames = subscriber.frames;
      subscriber.frames = [];
      subscriber.bytes = 0;
      if (frames.some(frame => frame.key)) subscriber.delivered = subscriber.generation;
      return { generation: subscriber.generation, sequence: device.sequence, dropped: subscriber.dropped, configuration: device.configuration, frames };
    } finally { subscriber.wake = undefined; subscriber.reading = false; }
  }

  private touch(device: Device, subscriber: Subscriber, samples: NativeTouchSample[], generation: number): Promise<void> {
    const result = device.input.then(async () => {
      this.check(device, subscriber);
      if (subscriber.delivered !== generation || device.generation === undefined) throw new Error("Wait for a fresh physical iOS screen before sending input.");
      if (device.pointer && device.pointer.owner !== subscriber) throw new IosMirrorInputBusyError();
      const nativeGeneration = device.generation;
      await device.capture.touch(samples, nativeGeneration);
      if (subscriber.delivered !== generation || device.generation !== nativeGeneration) return;
      const last = samples.at(-1);
      if (last === undefined || last.phase === 2) device.pointer = undefined;
      else device.pointer = { owner: subscriber, sample: last, generation: device.generation };
    });
    device.input = result.catch(() => {});
    return result;
  }

  private async unsubscribe(udid: string, device: Device, subscriber: Subscriber) {
    if (subscriber.closed) return;
    subscriber.closed = true;
    subscriber.wake?.();
    device.subscribers.delete(subscriber);
    try { await this.releasePointer(device, subscriber); }
    catch (error) { if (error instanceof Error) this.failed(error); }
    if (device.subscribers.size === 0) {
      device.closed = true;
      try { await device.capture.close(); await device.reader; }
      finally { this.devices.delete(udid); }
    }
    this.report();
  }

  async close() {
    this.disposed = true;
    await Promise.all(this.operations.values());
    for (const [udid, device] of this.devices) {
      const subscribers = [...device.subscribers];
      for (const subscriber of subscribers) await this.exclusive(udid, () => this.unsubscribe(udid, device, subscriber));
    }
  }

  snapshot(): MirrorHubState {
    let subscribers = 0;
    for (const device of this.devices.values()) subscribers += device.subscribers.size;
    return { captures: this.devices.size, subscribers, dropped: this.dropped };
  }
}
