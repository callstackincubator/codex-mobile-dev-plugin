import { StopReconnectError } from "./reconnect.ts";

type Callbacks = {
  frame(frame: VideoFrame): void;
  inputBlocked(message: string): void;
};

export class VideoStream {
  private readonly socket: WebSocket;
  private readonly decoder: VideoDecoder;
  private timestamp = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private resolve?: () => void;
  private reject?: (error: Error) => void;
  readonly finished: Promise<void>;

  constructor(url: string, fps: number, callbacks: Callbacks) {
    if (typeof VideoDecoder === "undefined") throw new StopReconnectError("This host does not support H.264 video decoding. Update the desktop app to use streaming.");
    const target = new URL(url);
    if (target.protocol !== "wss:" || target.hostname !== "127.0.0.1" || target.username || target.password || !/^\/[a-f0-9]{64}$/.test(target.pathname)) {
      throw new StopReconnectError("The plugin returned an invalid local streaming address.");
    }
    this.finished = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.decoder = new VideoDecoder({
      output: frame => {
        if (this.disposed) { frame.close(); return; }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.fail(new Error("Simulator video stopped arriving.")); }, 10000);
        callbacks.frame(frame);
      },
      error: error => { this.fail(new StopReconnectError(`H.264 decoding failed: ${error.message}`)); },
    });
    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
    this.timer = setTimeout(() => {
      this.fail(new StopReconnectError("Could not connect to local streaming. Check the certificate setup and allow local network access if the desktop app asks."));
    }, 15000);
    this.socket.onmessage = event => {
      try {
        if (event.data instanceof ArrayBuffer) {
          this.decode(event.data, fps);
        } else {
          const message = JSON.parse(event.data);
          if (message.inputBlocked) { callbacks.inputBlocked(message.error); return; }
          if (message.type === "error" || message.ok === false) this.fail(new Error(message.error ?? "The simulator stream failed."));
        }
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.fail(failure);
      }
    };
    this.socket.onclose = () => { this.fail(new Error("The simulator video connection closed.")); };
    this.socket.onerror = () => {
      this.fail(new StopReconnectError("Local streaming could not connect. Check the certificate setup and local network permission, then press Start."));
    };
  }

  private decode(data: ArrayBuffer, fps: number) {
    const bytes = new Uint8Array(data);
    if (bytes.length < 2) throw new Error("The simulator returned an incomplete video packet.");
    const tag = bytes[0];
    const payload = bytes.subarray(1);
    if (tag === 1) {
      if (payload.length < 4) throw new Error("The simulator returned an invalid H.264 configuration.");
      const profile = payload[1].toString(16).padStart(2, "0");
      const compatibility = payload[2].toString(16).padStart(2, "0");
      const level = payload[3].toString(16).padStart(2, "0");
      this.decoder.configure({ codec: `avc1.${profile}${compatibility}${level}`, description: payload, optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" });
      this.timestamp = 0;
    } else if (tag === 2 || tag === 3) {
      if (this.decoder.state !== "configured") throw new Error("H.264 video arrived before its configuration.");
      if (this.decoder.decodeQueueSize > 8) throw new StopReconnectError("Video decoding cannot keep up. Pause and restart streaming.");
      const chunk = new EncodedVideoChunk({ type: tag === 2 ? "key" : "delta", timestamp: this.timestamp, data: payload });
      this.timestamp += 1_000_000 / fps;
      this.decoder.decode(chunk);
    } else if (tag !== 4) {
      throw new Error("The simulator returned an unknown video packet.");
    }
  }

  send(message: object) {
    if (this.disposed || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 64 * 1024) { this.fail(new Error("Simulator input is backed up. Reconnecting.")); return; }
    const encoded = JSON.stringify(message);
    this.socket.send(encoded);
  }

  private fail(error: Error) {
    if (this.disposed) return;
    this.dispose();
    this.reject?.(error);
  }

  close() {
    this.dispose();
    this.resolve?.();
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.socket.close();
    this.decoder.close();
  }
}
