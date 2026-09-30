import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { GdbPacketDecoder, encodePacket } from "../src/server/cpu/gdb.ts";
import { startIosCpuMonitor } from "../src/server/cpu/monitor.ts";
import type { CpuReading } from "../src/server/cpu/counters.ts";
import { createConnection } from "node:net";

async function connectSocket(host: string, port: number, signal: AbortSignal): Promise<Socket> {
  const socket = createConnection({ host, port, signal });
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  socket.on("error", () => {});
  return socket;
}

async function server(options: { attach?: string; interruptStops?: string[]; beforeDisable?: string } = {}) {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const sendPacket = (socket: Socket, value: string) => {
    const packet = encodePacket(value);
    socket.write(packet);
  };
  const send = (value: string) => {
    for (const socket of sockets) sendPacket(socket, value);
  };
  const interruptStops = [...options.interruptStops ?? []];
  let beforeDisable = options.beforeDisable;
  let sampleNumber = 0;
  const sample = () => {
    const elapsed = 1000000 + sampleNumber * 250000;
    const used = 100000 + sampleNumber * 125000;
    sampleNumber++;
    send(`Aelapsed_usec:${elapsed};task_used_usec:0;thread_used_id:1;thread_used_usec:${used};phys_footprint:104857600;--end--;`);
  };
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    const decoder = new GdbPacketDecoder();
    socket.on("data", (bytes: Buffer) => {
      // A resume and a raw Ctrl-C can share a TCP chunk during detach.
      for (const byte of bytes) {
        if (byte === 3) {
          commands.push("interrupt");
          const stop = interruptStops.shift() ?? "T02thread:1;";
          send(stop);
          continue;
        }
        const chunk = Buffer.from([byte]);
        const packets = decoder.push(chunk);
        for (const command of packets) {
          if (command === "+") continue;
          commands.push(command);
          if (command.startsWith("vAttach")) send(options.attach ?? "T05thread:1;");
          else if (command === "c" || command.startsWith("vCont;")) {
            if (sampleNumber === 0) sample();
            sample();
          } else {
            if (command.includes("enable:0;") && beforeDisable) {
              send(beforeDisable);
              beforeDisable = undefined;
            }
            send("OK");
          }
        }
      }
    });
  });
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Test server failed to listen.");
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  };
  const openTransport = async (signal: AbortSignal) => {
    const socket = await connectSocket("127.0.0.1", address.port, signal);
    return { socket, close: async () => {}, exited: new Promise<number>(() => {}) };
  };
  return { commands, close, openTransport, send };
}

test("attaches once, streams counters while running, interrupts only for detach", async () => {
  const endpoint = await server();
  const samples: CpuReading[] = [];
  try {
    const monitor = await startIosCpuMonitor({
      pid: 123, signal: new AbortController().signal,
      onSample: (sample) => samples.push(sample),
    }, endpoint.openTransport);
    await monitor.stop();
    assert.equal(samples.at(-1)?.cpuPercent, 50);
    assert.equal(samples.at(-1)?.memoryBytes, 104857600);
    assert.deepEqual(endpoint.commands, [
      "QStartNoAckMode", "QSetDetachOnError:1", "vAttach;7b",
      "QSetEnableAsyncProfiling;enable:1;interval_usec:1000000;scan_type:0x4e;", "c", "interrupt",
      "QSetEnableAsyncProfiling;enable:0;interval_usec:1000000;scan_type:0x4e;", "D",
    ]);
    await monitor.stop();
    assert.equal(endpoint.commands.filter((command) => command === "D").length, 1);
  } finally { await endpoint.close(); }
});

test("an attach rejection does not send process control or kill commands", async () => {
  const endpoint = await server({ attach: "E01" });
  try {
    const starting = startIosCpuMonitor({
      pid: 123, signal: new AbortController().signal, onSample: () => {},
    }, endpoint.openTransport);
    await assert.rejects(starting, error => { assert.ok(error instanceof Error); assert.ok(error.message.includes("detach Xcode/LLDB")); return true; });
    assert.deepEqual(endpoint.commands, ["QStartNoAckMode", "QSetDetachOnError:1", "vAttach;7b"]);
  } finally { await endpoint.close(); }
});

test("cleanup after a disconnect does not wait for a debugger that has already closed", async () => {
  const endpoint = await server();
  const controller = new AbortController();
  const monitor = await startIosCpuMonitor({
    pid: 123, signal: controller.signal, onSample: () => {},
  }, endpoint.openTransport);
  await endpoint.close();
  await monitor.closed;
  const stopping = monitor.stop();
  await assert.rejects(stopping, error => { assert.ok(error instanceof Error); assert.ok(error.message.includes("connection is closed")); return true; });
});

test("delivers repeated Hermes sampling signals to the original thread and keeps CPU collection active", async () => {
  const endpoint = await server();
  const samples: CpuReading[] = [];
  let nextSample: (() => void) | undefined;
  const initialSamples = new Promise<void>((resolve) => { nextSample = resolve; });
  let ended = false;
  const monitor = await startIosCpuMonitor({
    pid: 123, signal: new AbortController().signal,
    onSample: (sample) => {
      samples.push(sample);
      if (samples.length >= 2) nextSample?.();
    },
  }, endpoint.openTransport);
  void monitor.closed.then(() => { ended = true; });
  try {
    await initialSamples;
    for (const thread of ["ffffffff00000001", "abc123"]) {
      const sampled = new Promise<void>((resolve) => { nextSample = resolve; });
      endpoint.send(`T1bthread:${thread};metype:5;mecount:2;medata:10003;medata:1b;`);
      await sampled;
      assert.ok(endpoint.commands.includes(`vCont;C1b:${thread};c`));
      assert.equal(ended, false);
    }
    assert.equal(samples.length, 4);
    const last = samples.at(-1);
    assert.equal(last?.cpuPercent, 50);
    assert.ok(endpoint.commands.includes("D") === false);
  } finally {
    await monitor.stop();
    await endpoint.close();
  }
});

test("preserves a sampling signal reported by attach to an already profiling app", async () => {
  const endpoint = await server({ attach: "T1bthread:ffff000012345678;" });
  const monitor = await startIosCpuMonitor({
    pid: 123, signal: new AbortController().signal, onSample: () => {},
  }, endpoint.openTransport);
  try {
    assert.ok(endpoint.commands.includes("vCont;C1b:ffff000012345678;c"));
    assert.ok(endpoint.commands.includes("c") === false);
  } finally {
    await monitor.stop();
    await endpoint.close();
  }
});

test("delivers sampling signals that race detach before interrupting again", async () => {
  const endpoint = await server({ interruptStops: ["T1bthread:1234;", "T1bthread:5678;"] });
  const monitor = await startIosCpuMonitor({
    pid: 123, signal: new AbortController().signal, onSample: () => {},
  }, endpoint.openTransport);
  try {
    await monitor.stop();
    const cleanup = endpoint.commands.slice(-8);
    assert.deepEqual(cleanup, [
      "c", "interrupt", "vCont;C1b:1234;c", "interrupt", "vCont;C1b:5678;c", "interrupt",
      "QSetEnableAsyncProfiling;enable:0;interval_usec:1000000;scan_type:0x4e;", "D",
    ]);
  } finally { await endpoint.close(); }
});

test("an asynchronous sampling signal cannot consume a configuration reply during detach", async () => {
  const endpoint = await server({ beforeDisable: "T1bthread:abc;" });
  const monitor = await startIosCpuMonitor({
    pid: 123, signal: new AbortController().signal, onSample: () => {},
  }, endpoint.openTransport);
  try {
    await monitor.stop();
    const cleanup = endpoint.commands.slice(-6);
    assert.deepEqual(cleanup, [
      "interrupt", "QSetEnableAsyncProfiling;enable:0;interval_usec:1000000;scan_type:0x4e;",
      "vCont;C1b:abc;c", "interrupt",
      "QSetEnableAsyncProfiling;enable:0;interval_usec:1000000;scan_type:0x4e;", "D",
    ]);
  } finally { await endpoint.close(); }
});

test("real app exceptions still end collection instead of being resumed as profiling signals", async () => {
  const endpoint = await server();
  const monitor = await startIosCpuMonitor({
    pid: 123, signal: new AbortController().signal, onSample: () => {},
  }, endpoint.openTransport);
  try {
    endpoint.send("T0bthread:1;metype:1;mecount:2;medata:1;medata:0;");
    const error = await monitor.closed;
    assert.ok(error.message.includes("app stopped or exited"));
    await monitor.stop();
    const resumes = endpoint.commands.filter((command) => command.startsWith("vCont;"));
    assert.equal(resumes.length, 0);
  } finally { await endpoint.close(); }
});
