// Screen adapter dependencies from Baguette db17446e25059247879dba7941e4de641c2f31e2
// (Apache-2.0). These fixtures let the real adapter run without SwiftPM downloads.
import Foundation
import IOSurface

protocol Screen: AnyObject, Sendable {
    func start(onFrame: @escaping @Sendable (IOSurface) -> Void) throws
    func stop()
}

protocol DeviceHost: AnyObject, Sendable {
    func resolveDevice(udid: String) -> NSObject?
}

struct Size: Sendable {
    let width: Double
    let height: Double
}

enum DisplayKind: Sendable { case phone, carPlay }

struct DisplayBinding: Sendable {
    let kind: DisplayKind
    let size: Size
}

enum SimulatorError: Error { case notFound(udid: String) }

final class StandaloneDeviceHost: DeviceHost, @unchecked Sendable {
    private let device: NSObject
    init(device: NSObject) { self.device = device }
    func resolveDevice(udid: String) -> NSObject? { device }
}
