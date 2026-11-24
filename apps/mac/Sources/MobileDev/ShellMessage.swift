/// A message the page posts to `window.webkit.messageHandlers.shell`.
enum ShellMessage {
  /// The page connected to the server and its device panels are available.
  case ready
  case error(String)

  init?(body: Any) {
    guard let fields = body as? [String: Any], let type = fields["type"] as? String else { return nil }
    switch type {
    case "ready":
      self = .ready
    case "error":
      self = .error(fields["message"] as? String ?? "The page reported an error.")
    default:
      return nil
    }
  }
}
