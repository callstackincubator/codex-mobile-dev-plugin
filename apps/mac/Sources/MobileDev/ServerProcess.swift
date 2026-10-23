import Foundation
import os

/// Runs the Mobile Dev MCP server over stdio, the way Codex launches it.
///
/// Reading, writing and buffering happen on one owned serial queue. Each complete
/// stdout line and the exit status cross to the main thread once, at delivery.
final class ServerProcess: @unchecked Sendable {
  private let process = Process()
  private let input = Pipe()
  private let output = Pipe()
  private let errors = Pipe()
  // Confined to `queue`.
  private let queue = DispatchQueue(label: "com.callstack.mobile-dev.server")
  private var lines = LineBuffer()
  private let log = Logger(subsystem: "com.callstack.mobile-dev", category: "server")

  init(runtime: ServerRuntime) {
    process.executableURL = runtime.node
    process.arguments = [runtime.server.path]
    process.currentDirectoryURL = runtime.server.deletingLastPathComponent()
    var environment = ProcessInfo.processInfo.environment
    environment["MOBILE_DEV_HOST"] = "mac"
    process.environment = environment
    process.standardInput = input
    process.standardOutput = output
    process.standardError = errors
  }

  /// Starts the server. `onLine` receives each JSON-RPC line and `onExit` the exit status, both on the main thread.
  func start(onLine: @escaping @MainActor (String) -> Void, onExit: @escaping @MainActor (Int32) -> Void) throws {
    output.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard let self, !data.isEmpty else { return }
      self.queue.async {
        let complete = self.lines.append(data).map { String(decoding: $0, as: UTF8.self) }
        guard !complete.isEmpty else { return }
        DispatchQueue.main.async { for line in complete { onLine(line) } }
      }
    }
    errors.fileHandleForReading.readabilityHandler = { [log] handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      log.info("\(String(decoding: data, as: UTF8.self), privacy: .public)")
    }
    process.terminationHandler = { [output, errors] process in
      output.fileHandleForReading.readabilityHandler = nil
      errors.fileHandleForReading.readabilityHandler = nil
      let status = process.terminationStatus
      DispatchQueue.main.async { onExit(status) }
    }
    try process.run()
  }

  /// Writes one JSON-RPC message followed by the newline that frames it.
  func send(_ line: String) {
    queue.async { [input, log] in
      do { try input.fileHandleForWriting.write(contentsOf: Data((line + "\n").utf8)) }
      catch { log.error("Could not write to the server: \(error.localizedDescription, privacy: .public)") }
    }
  }

  /// Asks the server to shut down; it stops its Baguette child and device streams first.
  func stop() {
    guard process.isRunning else { return }
    process.terminate()
  }
}
