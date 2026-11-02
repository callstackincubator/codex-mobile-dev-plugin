import SwiftUI

@main
struct MobileDevApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    Window("Mobile Dev", id: "main") {
      ContentView(model: delegate.model)
        .frame(minWidth: 1280, minHeight: 720)
    }
    .windowStyle(.hiddenTitleBar)
    .commands {
      CommandGroup(after: .toolbar) {
        Button("Restart Server") { delegate.model.restart() }
          .keyboardShortcut("r", modifiers: [.command, .shift])
      }
    }
  }
}
