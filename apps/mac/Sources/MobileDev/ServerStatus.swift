enum ServerStatus: Equatable {
  case starting
  case ready
  case failed(String)

  var label: String {
    switch self {
    case .starting: "Starting server…"
    case .ready: "Connected"
    case .failed(let message): message
    }
  }
}
