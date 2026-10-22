import SwiftUI
import Combine

// MARK: - Model values

struct User: Identifiable, Hashable {
  var id: String
  var name: String
  var handle: String
  var followers: Int
  var bio: String

  /// The `.mock` convention the parser's `mockStatic` rung keys off.
  static let mock = User(
    id: "u_1",
    name: "Ada Lovelace",
    handle: "@ada",
    followers: 12_084,
    bio: "Mathematician. Writes notes on the Analytical Engine."
  )
}

struct Order: Identifiable, Hashable {
  var id: String
  var total: Decimal
  var placed: Date
  var items: [String]

  static let mock = Order(
    id: "A-1042",
    total: 48.50,
    placed: Date(timeIntervalSince1970: 1_700_000_000),
    items: ["Flat white", "Almond croissant"]
  )
}

// MARK: - Capture-time state hygiene
//
// Root-owned `ObservableObject`s outlive a capture: dismissing the overlay resets
// the *view* identity, not the store, so anything a presented screen wrote into a
// root store is visible to the next capture. An in-process reset would need every
// store in the app to conform to a protocol of ours, which is the per-screen source
// change this harness exists to avoid.
//
// The stores below therefore have no reset at all. State is reset by relaunching the
// process between captures (~620 ms measured): a fresh process cannot leak, it needs
// nothing from the app, and it isolates a crashing screen for free.

// MARK: - In-flight work tracking
//
// The `idle` readiness signal needs to know whether anything is still
// outstanding. There is no general way to observe an arbitrary app's async
// work, so this is an *opt-in* ledger: a store brackets its own work. See the
// report for what this therefore cannot see.

@MainActor
final class WorkTracker {
  static let shared = WorkTracker()

  private(set) var outstanding: [String: Int] = [:]
  /// Monotonic marker: the last time `outstanding` went from non-empty to empty
  /// (or the last time anything changed), so `idle` can require a quiet window.
  private(set) var lastChange: CFAbsoluteTime = CFAbsoluteTimeGetCurrent()

  var total: Int { outstanding.values.reduce(0, +) }

  func begin(_ tag: String) {
    outstanding[tag, default: 0] += 1
    lastChange = CFAbsoluteTimeGetCurrent()
  }

  func end(_ tag: String) {
    let n = (outstanding[tag] ?? 0) - 1
    if n <= 0 { outstanding.removeValue(forKey: tag) } else { outstanding[tag] = n }
    lastChange = CFAbsoluteTimeGetCurrent()
  }

  func reset() {
    outstanding.removeAll()
    lastChange = CFAbsoluteTimeGetCurrent()
  }
}

// MARK: - App-root environment

/// Injected at the app root with `.environmentObject`. A screen reading this
/// MUST be presented inside the root's environment or SwiftUI traps.
/// `@MainActor` is explicit now that the store conforms to nothing of ours: it used to be
/// inherited from the `CaptureResettable` conformance, and these stores touch `@Published`
/// state and the work ledger from the main thread either way.
@MainActor
final class AppSession: ObservableObject {
  @Published var displayName: String = "ada.lovelace"
  @Published var isPro: Bool = true
  /// Mutated by a presented screen, to test state leaking between captures.
  @Published var tapCount: Int = 0
}

/// A custom `@Environment` value, also injected at the app root.
struct ThemeAccent: EnvironmentKey {
  static let defaultValue = Color.gray
}

extension EnvironmentValues {
  var themeAccent: Color {
    get { self[ThemeAccent.self] }
    set { self[ThemeAccent.self] = newValue }
  }
}

/// A custom `@Environment` key the app root deliberately NEVER installs.
///
/// This is the negative control for the environment audit. A screen reading it
/// renders a complete, plausible, entirely wrong result and nothing anywhere
/// reports a problem -- no trap, no log, no visual tell.
struct BrandTint: EnvironmentKey {
  static let defaultValue = Color.gray
}

extension EnvironmentValues {
  var brandTint: Color {
    get { self[BrandTint.self] }
    set { self[BrandTint.self] = newValue }
  }
}

/// A store whose content arrives asynchronously. Instantiating a screen that
/// reads this does NOT populate it: the deliberately honest "misleading
/// screenshot" case.
@MainActor
final class FeedStore: ObservableObject {
  @Published var posts: [String] = []
  @Published var isLoading: Bool = false

  func load() {
    isLoading = true
    WorkTracker.shared.begin("FeedStore.load")
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      WorkTracker.shared.end("FeedStore.load")
      guard let self else { return }
      self.posts = ["Shipped the registry", "Simulator is warm", "Third post"]
      self.isLoading = false
    }
  }
}

/// Data that arrives in TWO stages: a header first, line items much later.
/// Between the stages the screen looks finished -- a header, a total, and an
/// empty item area that reads as "this order has no items" rather than
/// "the items have not arrived".
@MainActor
final class TwoStageOrderStore: ObservableObject {
  @Published var header: String?
  @Published var items: [String] = []
  @Published var stage: Int = 0

  func load() {
    guard stage == 0 else { return }
    stage = 1
    WorkTracker.shared.begin("TwoStageOrderStore.header")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      WorkTracker.shared.end("TwoStageOrderStore.header")
      guard let self else { return }
      self.header = "Order A-1042 - $48.50"
      self.stage = 2
      WorkTracker.shared.begin("TwoStageOrderStore.items")
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.25) { [weak self] in
        WorkTracker.shared.end("TwoStageOrderStore.items")
        guard let self else { return }
        self.items = ["Flat white", "Almond croissant", "Sparkling water"]
        self.stage = 3
      }
    }
  }
}

/// A store that is legitimately, permanently empty. Nothing is in flight and
/// nothing ever arrives: the screenshot of "nothing here" IS the correct
/// screenshot. A signal that cannot separate this from `FeedStore` pre-load is
/// not a readiness signal.
@MainActor
final class InboxStore: ObservableObject {
  @Published var messages: [String] = []
  /// Never set: there is no fetch.
  let isLoading = false
}

// MARK: - Route enum driving navigationDestination(for:)

enum Route: Hashable {
  case profile(User)
  case orderDetail(String)
  case about
}
