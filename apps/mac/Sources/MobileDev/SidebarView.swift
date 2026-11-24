import SwiftUI

struct SidebarView: View {
  let model: WorkspaceModel

  var body: some View {
    List(selection: Binding(get: { model.tool }, set: { model.select(tool: $0) })) {
      Section("Tools") {
        ForEach(Tool.allCases) { tool in
          Label(tool.title, systemImage: tool.systemImage).tag(tool)
        }
      }
    }
    .listStyle(.sidebar)
    .safeAreaInset(edge: .bottom) { ServerStatusView(model: model) }
  }
}
