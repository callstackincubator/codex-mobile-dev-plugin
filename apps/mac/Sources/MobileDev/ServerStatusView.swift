import SwiftUI

struct ServerStatusView: View {
  let model: WorkspaceModel

  var body: some View {
    HStack(spacing: 8) {
      switch model.status {
      case .starting:
        ProgressView().controlSize(.small)
      case .ready:
        Image(systemName: "circle.fill").font(.system(size: 7)).foregroundStyle(.green)
      case .failed:
        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
      }
      Text(model.status.label)
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(3)
        .textSelection(.enabled)
      Spacer(minLength: 0)
      if case .failed = model.status {
        Button("Restart") { model.restart() }.controlSize(.small)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }
}
