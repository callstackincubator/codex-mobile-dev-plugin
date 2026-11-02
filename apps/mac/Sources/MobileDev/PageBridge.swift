import WebKit
import os

/// Owns the web view that renders the shared Mobile Dev UI and carries its traffic:
/// JSON-RPC between the page and the server, and selection from the native sidebar.
@MainActor
final class PageBridge: NSObject, WKScriptMessageHandler {
  let webView: WKWebView
  /// Receives each JSON-RPC message the page sends to the server.
  var onServerMessage: (String) -> Void = { _ in }
  var onShellMessage: (ShellMessage) -> Void = { _ in }

  private let log = Logger(subsystem: "com.callstack.mobile-dev", category: "page")

  /// A stable origin so the page keeps its local storage between launches.
  private static let origin = URL(string: "https://mobile-dev.app.local/")

  override init() {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.isInspectable = true
    super.init()
    let proxy = WeakScriptMessageHandler(self)
    webView.configuration.userContentController.add(proxy, name: "mcp")
    webView.configuration.userContentController.add(proxy, name: "shell")
  }

  func load(html: String) { webView.loadHTMLString(html, baseURL: Self.origin) }

  /// Hands one server line to the page. Each line is a JSON object, which is also a valid JavaScript expression.
  func deliver(_ line: String) {
    webView.evaluateJavaScript("window.__mobileDevReceive?.(\(line)); undefined") { [log] _, error in
      if let error { log.error("The page rejected a server message: \(error.localizedDescription, privacy: .public)") }
    }
  }

  func select(tool: Tool?) {
    let argument = tool.map { "'\($0.rawValue)'" } ?? "null"
    webView.evaluateJavaScript("window.mobileDevShell?.selectTool(\(argument))", completionHandler: nil)
  }

  func select(layout: DeviceLayout) {
    webView.evaluateJavaScript("window.mobileDevShell?.selectLayout('\(layout.rawValue)')", completionHandler: nil)
  }

  func setTitlebarInset(_ size: CGSize) {
    webView.evaluateJavaScript("window.mobileDevShell?.setTitlebarInset(\(size.width), \(size.height))", completionHandler: nil)
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    switch message.name {
    case "mcp":
      if let line = message.body as? String { log.debug("Page sent \(line.prefix(120), privacy: .public)"); onServerMessage(line) }
    case "shell":
      if let shellMessage = ShellMessage(body: message.body) { onShellMessage(shellMessage) }
    default:
      break
    }
  }
}
