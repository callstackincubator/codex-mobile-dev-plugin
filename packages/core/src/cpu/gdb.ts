import type { Socket } from "node:net";

export function encodePacket(command: string): Buffer {
  const bytes = Buffer.from(command);
  let checksum = 0;
  for (const byte of bytes) checksum = (checksum + byte) & 255;
  const hex = checksum.toString(16);
  const suffix = hex.padStart(2, "0");
  return Buffer.from(`$${command}#${suffix}`);
}

export class GdbPacketDecoder {
  private buffer = Buffer.alloc(0);
  verifyChecksums = true;

  push(chunk: Buffer): Array<string | "+" | "-"> {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 1024 * 1024) throw new Error("Debugserver packet exceeds the size limit.");
    const packets: string[] = [];
    while (this.buffer.length > 0) {
      const first = this.buffer[0];
      if (first === 43 || first === 45) {
        packets.push(first === 43 ? "+" : "-");
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      if (first !== 36) throw new Error("Invalid debugserver packet header.");
      const end = this.buffer.indexOf(35, 1);
      if (end === -1 || this.buffer.length < end + 3) break;
      const payload = this.buffer.subarray(1, end);
      const checksumText = this.buffer.toString("ascii", end + 1, end + 3);
      if (!/^[\da-f]{2}$/i.test(checksumText)) throw new Error("Invalid debugserver checksum.");
      const expected = Number.parseInt(checksumText, 16);
      let checksum = 0;
      for (const byte of payload) checksum = (checksum + byte) & 255;
      if (this.verifyChecksums && checksum !== expected) throw new Error("Debugserver packet checksum mismatch.");
      const decoded: number[] = [];
      for (let i = 0; i < payload.length; i++) {
        const byte = payload[i];
        if (byte === 125) {
          if (++i >= payload.length) throw new Error("Truncated debugserver escape.");
          decoded.push(payload[i] ^ 32);
        } else if (byte === 42) {
          if (++i >= payload.length || decoded.length === 0) throw new Error("Invalid debugserver run length.");
          const repeats = payload[i] - 29;
          if (repeats < 3 || decoded.length + repeats > 1024 * 1024) throw new Error("Invalid debugserver run length.");
          const previous = decoded[decoded.length - 1];
          for (let repeat = 0; repeat < repeats; repeat++) decoded.push(previous);
        } else decoded.push(byte);
      }
      const bytes = Buffer.from(decoded);
      const text = bytes.toString("utf8");
      packets.push(text);
      this.buffer = this.buffer.subarray(end + 3);
    }
    return packets;
  }
}

export class ProfileAssembler {
  private buffer = "";
  push(chunk: string): string[] {
    this.buffer += chunk;
    if (this.buffer.length > 1024 * 1024) throw new Error("CPU profile response exceeds the size limit.");
    const profiles: string[] = [];
    let end = this.buffer.indexOf("--end--;");
    while (end >= 0) {
      const profile = this.buffer.slice(0, end);
      profiles.push(profile);
      this.buffer = this.buffer.slice(end + 8);
      end = this.buffer.indexOf("--end--;");
    }
    return profiles;
  }
}

type Pending = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  expectsStop: boolean;
};

export class GdbConnection {
  private socket: Socket;
  private decoder = new GdbPacketDecoder();
  private profiles = new ProfileAssembler();
  private pending: Pending | null = null;
  private noAck = false;
  private finished = false;
  private lastPacket: Buffer | null = null;
  private retransmits = 0;
  private finishClosed!: (error: Error) => void;
  readonly closed = new Promise<Error>((resolve) => { this.finishClosed = resolve; });
  onProfile: (profile: string) => void = () => {};
  onStop: (packet: string) => void = () => {};

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      try {
        const packets = this.decoder.push(chunk);
        for (const packet of packets) this.receive(packet);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error("Invalid debugger response.");
        socket.destroy(failure);
      }
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => {
      const error = new Error("The app disconnected from the CPU monitor.");
      this.fail(error);
    });
  }

  private fail(error: Error) {
    if (this.finished) return;
    this.finished = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    this.finishClosed(error);
  }

  private receive(packet: string) {
    if (packet === "+") return;
    if (packet === "-") {
      if (!this.lastPacket || ++this.retransmits > 2) throw new Error("Debugserver rejected the command checksum.");
      this.socket.write(this.lastPacket);
      return;
    }
    if (!this.noAck) this.socket.write("+");
    if (packet.startsWith("A")) {
      const body = packet.slice(1);
      const profiles = this.profiles.push(body);
      for (const profile of profiles) this.onProfile(profile);
      return;
    }
    if (packet.startsWith("O") && packet !== "OK") return; // App stdout is handled by the existing log service.
    if (packet.startsWith("JSON-async:")) return;
    // A sampling signal is asynchronous even if a configuration command is
    // awaiting OK. Only attach and interrupt consume a stop as their reply.
    if (/^[TSWX]/.test(packet) && !this.pending?.expectsStop) {
      this.onStop(packet);
      return;
    }
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(packet);
    }
  }

  request(command: string, timeoutMs = 5000): Promise<string> {
    if (this.pending || this.finished) {
      const message = this.finished ? "The debugger connection is closed." : "Overlapping debugger requests are not allowed.";
      const error = new Error(message);
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const name = command.split(";")[0];
        const error = new Error(`Debugserver timed out during ${name}.`);
        this.socket.destroy(error);
      }, timeoutMs);
      const expectsStop = command.startsWith("vAttach");
      this.pending = { resolve, reject, timer, expectsStop };
      this.send(command);
    });
  }

  async expectOK(command: string) {
    const response = await this.request(command);
    if (response !== "OK") {
      const name = command.split(";")[0];
      throw new Error(`Debugserver does not support ${name} (${response || "empty response"}).`);
    }
  }

  async initialize() {
    await this.expectOK("QStartNoAckMode");
    this.noAck = true;
    // Apple's no-ack mode deliberately sends #00 instead of calculating checksums.
    this.decoder.verifyChecksums = false;
    await this.expectOK("QSetDetachOnError:1");
  }

  send(command: string) {
    this.lastPacket = encodePacket(command);
    this.retransmits = 0;
    this.socket.write(this.lastPacket);
  }

  interrupt(): Promise<string> {
    if (this.pending || this.finished) {
      const message = this.finished ? "The debugger connection is closed." : "Cannot interrupt during a debugger request.";
      const error = new Error(message);
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("Debugserver did not stop for detach.");
        this.socket.destroy(error);
      }, 5000);
      this.pending = { resolve, reject, timer, expectsStop: true };
      const interrupt = Buffer.from([3]);
      this.socket.write(interrupt);
    });
  }

  close() { this.socket.destroy(); }
}
