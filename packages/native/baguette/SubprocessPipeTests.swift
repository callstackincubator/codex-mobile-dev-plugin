import Foundation
import Testing

#if MOBILE_DEV_SUBPROCESS_STANDALONE
#else
@testable import Baguette
#endif

@Suite("MobileDevSubprocessPipes", .serialized)
struct MobileDevSubprocessPipeTests {
    @Test func `stopping reading children leaves other descriptors open`() {
        // A descriptor closed twice lands on a pipe opened in between: its write or
        // read fails, or it reads another child's output.
        signal(SIGPIPE, SIG_IGN)
        let deadline = Date().addingTimeInterval(3)
        let children = DispatchGroup()
        for _ in 0..<4 {
            DispatchQueue.global().async(group: children) {
                while Date() < deadline {
                    let child = HostSubprocess()
                    let reading = DispatchSemaphore(value: 0)
                    try? child.run(
                        executable: URL(fileURLWithPath: "/usr/bin/yes"), arguments: [],
                        onBytes: { _ in reading.signal() }, onExit: { _ in }
                    )
                    _ = reading.wait(timeout: .now() + 1)
                    child.terminate()
                }
            }
        }
        let payload = Data("baguette\n".utf8)
        var damaged = 0
        while Date() < deadline {
            let pipe = Pipe()
            do {
                try pipe.fileHandleForWriting.write(contentsOf: payload)
                try pipe.fileHandleForWriting.close()
                if try pipe.fileHandleForReading.readToEnd() != payload { damaged += 1 }
            } catch {
                damaged += 1
            }
        }
        children.wait()
        #expect(damaged == 0)
    }
}
