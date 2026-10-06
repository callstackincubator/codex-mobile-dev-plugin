import Foundation

extension Server {
    /// Capture once in the requested format, without an intermediate JPEG.
    static func captureScreenshot(
        screen: any Screen,
        quality: Double,
        scale: Int,
        format: CaptureImageFormat,
        options: CaptureOptions
    ) async throws -> Data {
        let background: String
        switch options.background {
        case .transparent: background = "transparent"
        case .color(let hex): background = hex
        }
        return try await ScreenSnapshot.capture(
            screen: screen,
            quality: quality,
            scale: max(1, scale),
            size: options.size,
            fit: options.fit,
            background: background,
            format: format == .png ? .png : .jpeg
        )
    }
}
