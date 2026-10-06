import CoreGraphics
import CoreVideo
import Foundation
import IOSurface
import ImageIO
import Mockable
import Testing

@testable import Baguette

@Suite("Server screenshot capture")
struct ServerScreenshotCaptureTests {
    @Test func `PNG preserves sharp framebuffer pixels without a lossy intermediate`() async throws {
        let screen = try makeScreen()
        let data = try await Server.captureScreenshot(
            screen: screen, quality: 0.1, scale: 1, format: .png, options: .default
        )
        let image = try decode(data)
        let pixels = try rgba(image)
        #expect(image.width == 32 && image.height == 32)
        for y in 0..<32 {
            for x in 0..<32 {
                let pixel = (y * 32 + x) * 4
                #expect(Array(pixels[pixel..<(pixel + 4)]) == color(x: x, y: y))
            }
        }
        verify(screen).start(onFrame: .any).called(1)
        verify(screen).stop().called(1)
    }

    @Test func `JPEG and scale options still reach the capture encoder`() async throws {
        let screen = try makeScreen()
        let data = try await Server.captureScreenshot(
            screen: screen, quality: 0.85, scale: 2, format: .jpeg, options: .default
        )
        #expect(data.prefix(2) == Data([0xFF, 0xD8]))
        let image = try decode(data)
        #expect(image.width == 16 && image.height == 16)
        verify(screen).stop().called(1)
    }

    @Test(arguments: [CaptureFit.contain, .cover, .stretch])
    func `requested canvas size and fit are preserved`(fit: CaptureFit) async throws {
        let screen = try makeScreen()
        let options = Server.CaptureOptions(
            size: try CaptureSize.parse("16x32"), fit: fit, background: .color("#12ab34")
        )
        let image = try decode(await Server.captureScreenshot(
            screen: screen, quality: 1, scale: 1, format: .png, options: options
        ))
        #expect(image.width == 16 && image.height == 32)
        let pixels = try rgba(image)
        if fit == .contain {
            #expect(Array(pixels.prefix(4)) == [0x12, 0xab, 0x34, 255])
        } else {
            #expect(Array(pixels.prefix(4)) != [0x12, 0xab, 0x34, 255])
        }
        verify(screen).stop().called(1)
    }

    @Test func `PNG keeps transparent letterboxing`() async throws {
        let screen = try makeScreen()
        let options = Server.CaptureOptions(
            size: try CaptureSize.parse("16x32"), fit: .contain, background: .transparent
        )
        let image = try decode(await Server.captureScreenshot(
            screen: screen, quality: 1, scale: 1, format: .png, options: options
        ))
        let pixels = try rgba(image)
        #expect(pixels[3] == 0)
        #expect(pixels[(16 * 16 + 8) * 4 + 3] == 255)
        verify(screen).stop().called(1)
    }

    @Test func `capture errors still release the screen`() async throws {
        let screen = MockScreen()
        given(screen).start(onFrame: .any).willThrow(CaptureError.unavailable)
        given(screen).stop().willReturn(())
        await #expect(throws: CaptureError.unavailable) {
            _ = try await Server.captureScreenshot(
                screen: screen, quality: 1, scale: 1, format: .png, options: .default
            )
        }
        verify(screen).stop().called(1)
    }

    private enum CaptureError: Error { case unavailable }

    private func color(x: Int, y: Int) -> [UInt8] {
        x.isMultiple(of: 2) ? [255, 0, 0, 255] : [0, 0, 255, 255]
    }

    private func makeScreen() throws -> MockScreen {
        let surface = try #require(IOSurface(properties: [
            .width: 32, .height: 32, .bytesPerElement: 4,
            .bytesPerRow: 128, .pixelFormat: kCVPixelFormatType_32BGRA, .allocSize: 4096,
        ]))
        surface.lock(options: [], seed: nil)
        let bytes = surface.baseAddress.assumingMemoryBound(to: UInt8.self)
        for y in 0..<32 {
            for x in 0..<32 {
                let value = color(x: x, y: y)
                let offset = y * surface.bytesPerRow + x * 4
                bytes[offset] = value[2]
                bytes[offset + 1] = value[1]
                bytes[offset + 2] = value[0]
                bytes[offset + 3] = value[3]
            }
        }
        surface.unlock(options: [], seed: nil)
        let screen = MockScreen()
        given(screen).start(onFrame: .any).willProduce { onFrame in onFrame(surface) }
        given(screen).stop().willReturn(())
        return screen
    }

    private func decode(_ data: Data) throws -> CGImage {
        let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
        return try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
    }

    private func rgba(_ image: CGImage) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try #require(CGContext(
                data: buffer.baseAddress, width: image.width, height: image.height,
                bitsPerComponent: 8, bytesPerRow: image.width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
            ))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        return bytes
    }
}
