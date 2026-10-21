import Foundation
import IOSurface
import ObjectiveC
import Testing

#if MOBILE_DEV_SCREEN_STANDALONE
#else
import Mockable
@testable import Baguette
#endif

@Suite("MobileDevScreenLifecycle", .serialized)
struct MobileDevScreenLifecycleTests {
    @Test func `stopping waits for a frame read to finish`() throws {
        let descriptor = try MobileDevFramebuffer(blocked: true)
        let screen = makeScreen(descriptors: [descriptor])
        let stopped = DispatchSemaphore(value: 0)
        let stopping = DispatchSemaphore(value: 0)
        try screen.start { _ in }
        let entered = descriptor.entered.wait(timeout: .now() + 2)
        #expect(entered == .success)
        DispatchQueue.global().async {
            stopping.signal()
            screen.stop()
            stopped.signal()
        }
        let started = stopping.wait(timeout: .now() + 2)
        #expect(started == .success)
        let earlyStop = stopped.wait(timeout: .now() + 0.05)
        #expect(earlyStop == .timedOut)
        let unregisteredEarly = descriptor.unregistered
        #expect(unregisteredEarly == 0)
        descriptor.release.signal()
        if earlyStop == .timedOut {
            let finished = stopped.wait(timeout: .now() + 2)
            #expect(finished == .success)
        }
        let unregistered = descriptor.unregistered
        #expect(unregistered == 1)
        screen.stop()
        let repeated = descriptor.unregistered
        #expect(repeated == 1)
    }

    @Test func `a frame callback can stop its own screen`() throws {
        let descriptor = try MobileDevFramebuffer()
        let screen = makeScreen(descriptors: [descriptor])
        let stopped = DispatchSemaphore(value: 0)
        try screen.start { _ in
            screen.stop()
            stopped.signal()
        }
        let finished = stopped.wait(timeout: .now() + 2)
        #expect(finished == .success)
        let unregistered = descriptor.unregistered
        #expect(unregistered == 1)
    }

    @Test func `failed start releases callbacks already registered`() throws {
        let descriptor = try MobileDevFramebuffer()
        let unsupported = try MobileDevFramebuffer(supported: false)
        let screen = makeScreen(descriptors: [descriptor, unsupported])
        #expect(throws: ScreenError.callbackUnavailable) {
            try screen.start { _ in }
        }
        let unregistered = descriptor.unregistered
        #expect(unregistered == 1)
        screen.stop()
    }

    @Test func `old callbacks cannot deliver frames after a restart`() throws {
        let descriptor = try MobileDevFramebuffer()
        let screen = makeScreen(descriptors: [descriptor])
        let restarted = DispatchSemaphore(value: 0)
        let frames = MobileDevFrameCount()
        try screen.start { _ in
            screen.stop()
            do {
                try screen.start { _ in
                    let count = frames.next()
                    if count == 2 { descriptor.fireFirstCallback() }
                    if count >= 2 { restarted.signal() }
                }
            } catch {
                Issue.record("Screen restart failed: \(error)")
                restarted.signal()
            }
        }
        let delivered = restarted.wait(timeout: .now() + 2)
        #expect(delivered == .success)
        let stale = restarted.wait(timeout: .now() + 0.05)
        #expect(stale == .timedOut)
        screen.stop()
    }

    private func makeScreen(descriptors: [MobileDevFramebuffer]) -> SimulatorKitScreen {
        let ports = descriptors.map { MobileDevFramebufferPort(framebuffer: $0) }
        let io = MobileDevScreenIO(ports: ports)
        let device = MobileDevScreenDevice(io: io)
#if MOBILE_DEV_SCREEN_STANDALONE
        let host = StandaloneDeviceHost(device: device)
#else
        let host = MockDeviceHost()
        given(host).resolveDevice(udid: .any).willReturn(device)
#endif
        return SimulatorKitScreen(udid: "screen-lifecycle-test", host: host)
    }
}

private final class MobileDevFramebuffer: NSObject, @unchecked Sendable {
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    private let blocked: Bool
    private let supported: Bool
    private let surface: IOSurface
    private let lock = NSLock()
    private var unregisterCount = 0
    private var callbacks: [@convention(block) () -> Void] = []

    init(blocked: Bool = false, supported: Bool = true) throws {
        self.blocked = blocked
        self.supported = supported
        let properties: [String: Any] = [
            kIOSurfaceWidth as String: 16,
            kIOSurfaceHeight as String: 16,
            kIOSurfaceBytesPerElement as String: 4,
            kIOSurfaceBytesPerRow as String: 64,
        ]
        let dictionary = properties as CFDictionary
        let created = IOSurfaceCreate(dictionary)
        surface = try #require(created)
        super.init()
    }

    var unregistered: Int {
        lock.lock()
        defer { lock.unlock() }
        return unregisterCount
    }

    override func responds(to selector: Selector!) -> Bool {
        let registration = NSSelectorFromString("registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:")
        if selector == registration && supported == false { return false }
        return super.responds(to: selector)
    }

    @objc func framebufferSurface() -> IOSurface {
        if blocked {
            entered.signal()
            release.wait()
        }
        return surface
    }

    @objc(registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:)
    func register(_ uuid: NSUUID, callbackQueue: DispatchQueue,
                  frameCallback: @escaping @convention(block) () -> Void,
                  surfacesChangedCallback: @escaping @convention(block) () -> Void,
                  propertiesChangedCallback: @escaping @convention(block) () -> Void) {
        lock.lock()
        callbacks.append(frameCallback)
        lock.unlock()
    }

    func fireFirstCallback() {
        lock.lock()
        let callback = callbacks.first
        lock.unlock()
        callback?()
    }

    @objc(unregisterScreenCallbacksWithUUID:)
    func unregister(_ uuid: NSUUID) {
        lock.lock()
        unregisterCount += 1
        lock.unlock()
    }
}

private final class MobileDevFrameCount: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        count += 1
        return count
    }
}

private final class MobileDevFramebufferPort: NSObject {
    private let framebuffer: MobileDevFramebuffer

    init(framebuffer: MobileDevFramebuffer) { self.framebuffer = framebuffer }
    @objc func portIdentifier() -> NSString { "com.apple.framebuffer.display" }
    @objc func descriptor() -> NSObject { framebuffer }
}

private final class MobileDevScreenIO: NSObject {
    @objc let deviceIOPorts: [NSObject]
    init(ports: [NSObject]) { deviceIOPorts = ports }
}

private final class MobileDevScreenDevice: NSObject {
    private let screenIO: MobileDevScreenIO
    init(io: MobileDevScreenIO) { screenIO = io }
    @objc func io() -> NSObject { screenIO }
}
