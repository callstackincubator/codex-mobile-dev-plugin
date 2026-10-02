import Foundation
import Observation
import OSLog

@MainActor
@Observable
final class Diagnostics {
    private let logger = Logger(subsystem: "dev.mobile.testapp", category: "TestApp")
    private var memory: Data?
    private var worker: Task<UInt64, Never>?
    private(set) var isRunningCPU = false
    private(set) var holdsMemory = false
    private(set) var status = "Ready"

    func logInteraction(_ action: String) {
        logger.info("Interaction: \(action, privacy: .public)")
    }

    func emitLogs() {
        logger.info("Mobile Dev test info message")
        logger.warning("Mobile Dev test warning message")
        logger.error("Mobile Dev test error message (intentional)")
        status = "Sent info, warning, and error logs"
    }

    func toggleMemory() {
        if holdsMemory {
            memory = nil
            holdsMemory = false
            status = "Released test memory"
            logger.info("Released test memory")
        } else {
            memory = Data(repeating: 0xA5, count: 32 * 1_024 * 1_024)
            holdsMemory = true
            status = "Holding 32 MiB"
            logger.info("Allocated and touched 32 MiB of test memory")
        }
    }

    func runCPU() async {
        guard isRunningCPU == false else { return }
        isRunningCPU = true
        status = "Running CPU work for 5 seconds"
        logger.info("CPU work started")
        let task = Task.detached(priority: .userInitiated) {
            let start = ContinuousClock.now
            var checksum: UInt64 = 1
            while start.duration(to: .now) < .seconds(5) {
                if Task.isCancelled { break }
                for _ in 0..<10_000 {
                    checksum = checksum &* 6_364_136_223_846_793_005 &+ 1
                }
            }
            return checksum
        }
        worker = task
        let checksum = await task.value
        let cancelled = task.isCancelled
        worker = nil
        isRunningCPU = false
        status = cancelled ? "CPU work stopped" : "CPU work finished"
        logger.info("CPU work ended; cancelled=\(cancelled), checksum=\(checksum)")
    }

    func stop() {
        worker?.cancel()
        memory = nil
        holdsMemory = false
        if isRunningCPU == false {
            status = "Stopped and released test memory"
        }
        logger.info("Stopped workloads and released test memory")
    }
}
