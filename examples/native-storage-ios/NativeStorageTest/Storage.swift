import CoreData
import Foundation
import SwiftData

// Writes realistic data through each native storage API, so the Storage tool can be checked against real files.
// Every action runs from the UI, so the helpers live on the main actor.
@MainActor enum Storage {
  static let appGroup = "group.dev.mobile.nativestoragetest"
  static let fileManager = FileManager.default
  static var documents: URL { fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0] }
  static var support: URL {
    let url = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? fileManager.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
  static var caches: URL { fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0] }

  // MARK: UserDefaults

  static func signIn() {
    let defaults = UserDefaults.standard
    defaults.set("Ada Lovelace", forKey: "user.name")
    defaults.set(4211, forKey: "user.id")
    defaults.set(true, forKey: "isLoggedIn")
    defaults.set(Date(), forKey: "lastLogin")
    defaults.set(["swift", "ios", "debugging"], forKey: "user.interests")
    defaults.set(["plan": "pro", "seats": 3] as [String: Any], forKey: "subscription")
    defaults.set(Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), forKey: "avatar.header")
    defaults.set(try? JSONEncoder().encode(Session(token: "tok_live_1234", expiresAt: Date().addingTimeInterval(86_400))), forKey: "session")
  }

  static func signOut() {
    for key in ["user.name", "user.id", "isLoggedIn", "lastLogin", "user.interests", "subscription", "avatar.header", "session"] {
      UserDefaults.standard.removeObject(forKey: key)
    }
  }

  // MARK: App Group (shared with widgets and extensions)

  static func writeAppGroup() {
    let shared = UserDefaults(suiteName: appGroup)
    shared?.set("Plan your week", forKey: "widget.headline")
    shared?.set(3, forKey: "widget.unread")
    if let container = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
      try? Data("{\"items\":[\"Buy milk\",\"Call Ada\"]}".utf8).write(to: container.appendingPathComponent("widget-timeline.json"))
    }
  }

  // MARK: Core Data, with a model built in code so no .xcdatamodeld is needed

  static let coreData: NSPersistentContainer = {
    let note = NSEntityDescription()
    note.name = "Note"
    note.managedObjectClassName = NSStringFromClass(NSManagedObject.self)
    let title = NSAttributeDescription()
    title.name = "title"
    title.attributeType = .stringAttributeType
    let created = NSAttributeDescription()
    created.name = "createdAt"
    created.attributeType = .dateAttributeType
    let pinned = NSAttributeDescription()
    pinned.name = "pinned"
    pinned.attributeType = .booleanAttributeType
    note.properties = [title, created, pinned]
    let model = NSManagedObjectModel()
    model.entities = [note]
    let container = NSPersistentContainer(name: "Notes", managedObjectModel: model)
    container.loadPersistentStores { _, error in if let error { print("Core Data failed: \(error)") } }
    return container
  }()

  static func addNote() {
    let context = coreData.viewContext
    let note = NSManagedObject(entity: coreData.managedObjectModel.entitiesByName["Note"]!, insertInto: context)
    let count = (try? context.count(for: NSFetchRequest<NSManagedObject>(entityName: "Note"))) ?? 0
    note.setValue("Note \(count)", forKey: "title")
    note.setValue(Date(), forKey: "createdAt")
    note.setValue(count % 2 == 0, forKey: "pinned")
    try? context.save()
  }

  // MARK: SwiftData, in its default.store

  static let swiftData: ModelContainer = try! ModelContainer(for: TodoItem.self)

  static func addTask() {
    let context = swiftData.mainContext
    let count = (try? context.fetchCount(FetchDescriptor<TodoItem>())) ?? 0
    context.insert(TodoItem(title: "Task \(count + 1)", priority: count % 3, done: false))
    try? context.save()
  }

  // MARK: Files a native app commonly writes

  static func writeFiles() {
    let profile = Profile(name: "Ada Lovelace", email: "ada@example.com", roles: ["admin", "beta"], onboarding: .init(step: 3, completed: false))
    let json = JSONEncoder()
    json.outputFormatting = [.prettyPrinted, .sortedKeys]
    try? json.encode(profile).write(to: documents.appendingPathComponent("profile.json"))

    let plist = PropertyListEncoder()
    plist.outputFormat = .binary
    try? plist.encode(AppState(launches: 7, lastScreen: "settings", featureFlags: ["newOnboarding": true, "darkIcons": false])).write(to: support.appendingPathComponent("state.plist"))

    let archive = try? NSKeyedArchiver.archivedData(withRootObject: ["recentSearches": ["swiftui", "core data"], "scrollOffset": 240] as NSDictionary, requiringSecureCoding: false)
    try? archive?.write(to: documents.appendingPathComponent("recent.archive"))

    try? "Remember to test the logged-out flow.\n".write(to: documents.appendingPathComponent("notes.txt"), atomically: true, encoding: .utf8)
    try? Data(repeating: 0xAB, count: 256 * 1024).write(to: caches.appendingPathComponent("image-cache.bin"))
  }

  // MARK: Reading back what the app sees

  static func summary() -> [(String, String)] {
    let defaults = UserDefaults.standard
    let notes = (try? coreData.viewContext.count(for: NSFetchRequest<NSManagedObject>(entityName: "Note"))) ?? 0
    let tasks = (try? swiftData.mainContext.fetchCount(FetchDescriptor<TodoItem>())) ?? 0
    let files = ["profile.json", "recent.archive", "notes.txt"].filter { fileManager.fileExists(atPath: documents.appendingPathComponent($0).path) }
    return [
      ("UserDefaults user.name", defaults.string(forKey: "user.name") ?? "—"),
      ("App Group widget.unread", UserDefaults(suiteName: appGroup)?.object(forKey: "widget.unread").map { "\($0)" } ?? "—"),
      ("Core Data notes", "\(notes)"),
      ("SwiftData tasks", "\(tasks)"),
      ("Document files", files.isEmpty ? "—" : files.joined(separator: ", ")),
    ]
  }
}

struct Session: Codable { var token: String; var expiresAt: Date }
struct Profile: Codable { var name: String; var email: String; var roles: [String]; var onboarding: Onboarding; struct Onboarding: Codable { var step: Int; var completed: Bool } }
struct AppState: Codable { var launches: Int; var lastScreen: String; var featureFlags: [String: Bool] }

@Model final class TodoItem {
  var title: String
  var priority: Int
  var done: Bool
  var createdAt: Date
  init(title: String, priority: Int, done: Bool) { self.title = title; self.priority = priority; self.done = done; self.createdAt = .now }
}
