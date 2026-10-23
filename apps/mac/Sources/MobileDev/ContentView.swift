import SwiftUI

struct ContentView: View {
  let model: WorkspaceModel

  var body: some View {
    NavigationSplitView {
      SidebarView(model: model)
        .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
    } detail: {
      PageView(page: model.page)
        .navigationTitle(model.tool?.title ?? "Mobile Dev")
    }
  }
}
