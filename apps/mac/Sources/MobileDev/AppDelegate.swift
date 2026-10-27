import AppKit

/// Owns the workspace for the app's lifetime and stops the server when the app quits.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let model = WorkspaceModel()

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) { model.stop() }
}
