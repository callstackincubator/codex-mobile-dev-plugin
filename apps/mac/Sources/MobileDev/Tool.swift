/// A developer tool shown beside the devices. Raw values match the web page's tool names.
enum Tool: String, CaseIterable, Identifiable {
  case logs
  case performance
  case storage
  case tracesift

  var id: Self { self }

  var title: String {
    switch self {
    case .logs: "Logs"
    case .performance: "Performance"
    case .storage: "Storage"
    case .tracesift: "TraceSift"
    }
  }

  var systemImage: String {
    switch self {
    case .logs: "terminal"
    case .performance: "waveform.path.ecg"
    case .storage: "cylinder.split.1x2"
    case .tracesift: "chart.bar.xaxis"
    }
  }
}
