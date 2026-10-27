import SwiftUI
import WebKit

/// Embeds the bridge's long-lived web view, so the page survives SwiftUI view updates.
struct PageView: NSViewRepresentable {
  let page: PageBridge

  func makeNSView(context: Context) -> WKWebView { page.webView }
  func updateNSView(_ view: WKWebView, context: Context) {}
}
