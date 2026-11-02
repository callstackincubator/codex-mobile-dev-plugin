import Foundation

/// Reads the Mac page from the server before the page itself connects.
///
/// The server serves the page with its telemetry environment, opt-out and
/// anonymous identity, the same way it serves the Codex panel. Once the page
/// loads it initializes its own MCP client, which replaces this one's
/// capabilities on the same connection. String IDs keep these requests apart
/// from the page's numeric ones.
@MainActor
final class PageLoader {
  private static let pageURI = "ui://mobile-dev/mac.html"
  private let send: (String) -> Void
  private let completion: (Result<String, PageLoaderError>) -> Void
  private var finished = false

  init(send: @escaping (String) -> Void, completion: @escaping (Result<String, PageLoaderError>) -> Void) {
    self.send = send
    self.completion = completion
  }

  func begin() {
    request(id: "mac-initialize", method: "initialize", params: [
      "protocolVersion": "2025-06-18",
      "capabilities": [String: Any](),
      "clientInfo": ["name": "mobile-dev-mac-shell", "version": "1"],
    ])
  }

  /// Handles a server line if it answers one of the loader's requests.
  func receive(_ line: String) -> Bool {
    guard !finished, line.contains("\"id\":\"mac-"),
          let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
          let id = object["id"] as? String else { return false }
    if let error = object["error"] as? [String: Any] {
      finish(.failure(.server(error["message"] as? String ?? "The server rejected the request.")))
      return true
    }
    let result = object["result"] as? [String: Any]
    switch id {
    case "mac-initialize":
      notify(method: "notifications/initialized")
      request(id: "mac-page", method: "resources/read", params: ["uri": Self.pageURI])
    case "mac-page":
      let contents = result?["contents"] as? [[String: Any]]
      guard let html = contents?.first?["text"] as? String else {
        finish(.failure(.server("The server returned no Mac page. Rebuild the app with npm run build:mac.")))
        return true
      }
      finish(.success(html))
    default:
      return false
    }
    return true
  }

  private func finish(_ result: Result<String, PageLoaderError>) {
    finished = true
    completion(result)
  }

  private func request(id: String, method: String, params: [String: Any]) {
    write(["jsonrpc": "2.0", "id": id, "method": method, "params": params])
  }

  private func notify(method: String) { write(["jsonrpc": "2.0", "method": method]) }

  private func write(_ message: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    send(String(decoding: data, as: UTF8.self))
  }
}
