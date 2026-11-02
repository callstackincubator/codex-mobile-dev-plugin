/// A message the page posts to `window.webkit.messageHandlers.shell`.
enum ShellMessage {
  /// The page connected to the server and its device panels are available.
  case ready
  /// The page chose a layout itself, for example after the server opened a device.
  case layout(DeviceLayout)
  case error(String)

  init?(body: Any) {
    guard let fields = body as? [String: Any], let type = fields["type"] as? String else { return nil }
    switch type {
    case "ready":
      self = .ready
    case "layout":
      guard let raw = fields["layout"] as? String, let layout = DeviceLayout(rawValue: raw) else { return nil }
      self = .layout(layout)
    case "error":
      self = .error(fields["message"] as? String ?? "The page reported an error.")
    default:
      return nil
    }
  }
}
