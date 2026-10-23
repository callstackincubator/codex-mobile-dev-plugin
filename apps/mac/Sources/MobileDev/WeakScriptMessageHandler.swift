import WebKit

/// Forwards script messages without letting `WKUserContentController` retain the receiver.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
  private weak var target: (any WKScriptMessageHandler)?

  init(_ target: any WKScriptMessageHandler) { self.target = target }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(controller, didReceive: message)
  }
}
