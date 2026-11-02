import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sourcePatch } from "./baguette-source-patch.mjs";

const replaceOnce = sourcePatch("screen lifecycle");

export function serializeScreenLifecycle(adapter) {
  adapter = replaceOnce(adapter,
    '    private let queue = DispatchQueue(label: "baguette.screen", qos: .userInteractive)',
    `    private let queue = DispatchQueue(label: "baguette.screen", qos: .userInteractive)
    private let queueKey = DispatchSpecificKey<Bool>()
    private var generation: UInt64 = 0`);
  adapter = replaceOnce(adapter,
    "        self.binding = binding\n    }",
    "        self.binding = binding\n        queue.setSpecific(key: queueKey, value: true)\n    }");
  adapter = replaceOnce(adapter,
    `    func start(onFrame: @escaping @Sendable (IOSurface) -> Void) throws {
        self.onFrame = onFrame`,
    `    func start(onFrame: @escaping @Sendable (IOSurface) -> Void) throws {
        try onQueue {
            stopOnQueue()
            do {
                try startOnQueue(onFrame: onFrame)
            } catch {
                stopOnQueue()
                throw error
            }
        }
    }

    private func startOnQueue(onFrame: @escaping @Sendable (IOSurface) -> Void) throws {
        self.onFrame = onFrame`);
  adapter = replaceOnce(adapter,
    "    func stop() {\n        idleTimer?.cancel()",
    `    func stop() {
        onQueue { stopOnQueue() }
    }

    private func stopOnQueue() {
        generation &+= 1
        onFrame = nil
        pending = PendingCapture()
        idleTimer?.cancel()`);
  adapter = replaceOnce(adapter,
    "        ioClient = nil\n        onFrame = nil\n    }",
    `        ioClient = nil
    }

    private func onQueue<T>(_ operation: () throws -> T) rethrows -> T {
        let current = DispatchQueue.getSpecific(key: queueKey)
        if current == true { return try operation() }
        return try queue.sync(execute: operation)
    }`);
  adapter = replaceOnce(adapter,
    `        timer.setEventHandler { [weak self] in
            self?.scheduleCapture()
        }`,
    `        let generation = self.generation
        timer.setEventHandler { [weak self] in
            self?.scheduleCapture(generation: generation)
        }`);
  adapter = replaceOnce(adapter,
    "        queue.async { [weak self] in self?.scheduleCapture() }",
    `        let generation = self.generation
        queue.async { [weak self] in self?.scheduleCapture(generation: generation) }`);
  adapter = replaceOnce(adapter,
    `        let frame: @convention(block) () -> Void = { [weak self] in
            self?.scheduleCapture()
        }
        let surfaces: @convention(block) () -> Void = { [weak self] in
            self?.scheduleCapture()
        }`,
    `        let generation = self.generation
        let frame: @convention(block) () -> Void = { [weak self] in
            self?.scheduleCapture(generation: generation)
        }
        let surfaces: @convention(block) () -> Void = { [weak self] in
            self?.scheduleCapture(generation: generation)
        }`);
  adapter = replaceOnce(adapter,
    `    private func scheduleCapture() {
        guard pending.request() else { return }
        queue.async { [weak self] in
            guard let self else { return }`,
    `    private func scheduleCapture(generation: UInt64) {
        guard self.generation == generation, onFrame != nil else { return }
        guard pending.request() else { return }
        queue.async { [weak self] in
            guard let self, self.generation == generation, self.onFrame != nil else { return }`);
  return adapter;
}

export async function addScreenLifecycle(source) {
  const adapterPath = join(source, "Sources/Baguette/Infrastructure/Screen/SimulatorKitScreen.swift");
  const adapter = await readFile(adapterPath, "utf8");
  const updated = serializeScreenLifecycle(adapter);
  const testPath = join(source, "Tests/BaguetteTests/Screen/MobileDevScreenLifecycleTests.swift");
  await copyFile("packages/native/baguette/ScreenLifecycleTests.swift", testPath);
  await writeFile(adapterPath, updated);
}
