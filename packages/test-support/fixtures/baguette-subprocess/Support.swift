// Subprocess dependencies from Baguette db17446e25059247879dba7941e4de641c2f31e2
// (Apache-2.0). These fixtures let the real adapter run without SwiftPM downloads.
import Foundation

protocol Subprocess: AnyObject, Sendable {
    func run(
        executable: URL,
        arguments: [String],
        onBytes: @escaping @Sendable (Data) -> Void,
        onExit: @escaping @Sendable (Int32) -> Void
    ) throws
    func terminate()
    func kill()
}

enum SubprocessError: Error, Equatable {
    case notInteractive
}
