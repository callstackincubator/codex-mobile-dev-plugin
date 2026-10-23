import SwiftUI

struct ContentView: View {
  let model: WorkspaceModel
  @State private var columns: NavigationSplitViewVisibility = SmokeSnapshot.collapsedSidebar ? .detailOnly : .all

  var body: some View {
    NavigationSplitView(columnVisibility: $columns) {
      SidebarView(model: model)
        .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
    } detail: {
      // The page has its own toolbar row, so it runs up to the window's top edge. The
      // leading safe area stays: it keeps the page clear of the floating sidebar.
      PageView(page: model.page)
        .ignoresSafeArea(.container, edges: .top)
    }
    .toolbar(removing: .title)
    .onChange(of: columns, initial: true) { model.setSidebarVisible(columns != .detailOnly) }
  }
}
