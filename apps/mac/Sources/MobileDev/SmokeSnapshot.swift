import AppKit
import WebKit

/// Writes the page as a PNG for `tooling/smoke-mac.mjs`, which cannot rely on
/// Screen Recording permission. Enabled only by `MOBILE_DEV_SMOKE_SNAPSHOT=<path>`.
@MainActor
enum SmokeSnapshot {
  static let path = ProcessInfo.processInfo.environment["MOBILE_DEV_SMOKE_SNAPSHOT"]
  /// `MOBILE_DEV_SMOKE_SIDEBAR=collapsed` starts the window with the sidebar collapsed.
  static let collapsedSidebar = path != nil && ProcessInfo.processInfo.environment["MOBILE_DEV_SMOKE_SIDEBAR"] == "collapsed"

  /// Seconds to let the device panels draw first; `MOBILE_DEV_SMOKE_DELAY` overrides the default.
  private static let delay = Double(ProcessInfo.processInfo.environment["MOBILE_DEV_SMOKE_DELAY"] ?? "") ?? 6

  static func capture(_ webView: WKWebView) {
    guard let path else { return }
    Task {
      try? await Task.sleep(for: .seconds(delay))
      guard let image = try? await webView.takeSnapshot(configuration: nil),
            let tiff = image.tiffRepresentation,
            let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
      try? png.write(to: URL(fileURLWithPath: path))
    }
  }
}
