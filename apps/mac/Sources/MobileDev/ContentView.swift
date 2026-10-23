import SwiftUI

struct ContentView: View {
  let model: WorkspaceModel

  var body: some View {
    NavigationSplitView {
      SidebarView(model: model)
        .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
    } detail: {
      // The page has its own toolbar row, so it runs up to the window's top edge.
      PageView(page: model.page)
        .ignoresSafeArea()
    }
    .toolbar(removing: .sidebarToggle)
    .toolbar(removing: .title)
  }
}
