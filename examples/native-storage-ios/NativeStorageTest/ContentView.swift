import SwiftUI

struct ContentView: View {
  @State private var summary: [(String, String)] = []

  var body: some View {
    NavigationStack {
      List {
        Section("Actions") {
          action("Sign in", "UserDefaults: strings, numbers, dates, arrays, data, Codable") { Storage.signIn() }
          action("Sign out", "Removes the sign-in keys") { Storage.signOut() }
          action("Write App Group", "Shared UserDefaults and a widget file") { Storage.writeAppGroup() }
          action("Add Core Data note", "Notes.sqlite in Application Support") { Storage.addNote() }
          action("Add SwiftData task", "default.store in Application Support") { Storage.addTask() }
          action("Write files", "JSON, binary plist, NSKeyedArchiver, text, cache") { Storage.writeFiles() }
        }
        Section("What the app reads") {
          ForEach(summary, id: \.0) { row in
            LabeledContent(row.0, value: row.1).font(.footnote)
          }
        }
      }
      .navigationTitle("Native Storage")
      .onAppear { summary = Storage.summary() }
    }
  }

  private func action(_ title: String, _ detail: String, _ perform: @escaping @MainActor () -> Void) -> some View {
    Button {
      perform()
      summary = Storage.summary()
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
        Text(detail).font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}
