import SwiftUI

/// The native sidebar: tools to show beside the devices, the visible device platforms, and the server's state.
struct SidebarView: View {
  let model: WorkspaceModel

  var body: some View {
    List(selection: Binding(get: { model.tool }, set: { model.select(tool: $0) })) {
      Section("Tools") {
        ForEach(Tool.allCases) { tool in
          Label(tool.title, systemImage: tool.systemImage).tag(tool)
        }
      }
      Section("Devices") {
        Toggle(isOn: Binding(get: { model.layout.showsIOS }, set: { model.setShowsIOS($0) })) {
          Label("iOS", systemImage: "iphone")
        }
        Toggle(isOn: Binding(get: { model.layout.showsAndroid }, set: { model.setShowsAndroid($0) })) {
          Label("Android", systemImage: "candybarphone")
        }
      }
    }
    .listStyle(.sidebar)
    .safeAreaInset(edge: .bottom) { ServerStatusView(model: model) }
  }
}
