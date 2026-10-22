import Foundation

/// A single parameter the view's initializer requires.
struct ParamInfo: Codable {
  var label: String
  var type: String
  var hasDefault: Bool
  var isBinding: Bool
  var isClosure: Bool

  /// Params we can always satisfy without observing a real value.
  var trivallySatisfiable: Bool { hasDefault || isBinding || isClosure }
}

/// A `struct X: View` declaration found in the source tree.
struct ViewDecl: Codable {
  var name: String
  var file: String
  var line: Int
  var params: [ParamInfo]
  var hasExplicitInit: Bool
}

/// Where a construction expression such as `ProfileView(user: .mock)` was found.
enum CallContext: String, Codable {
  case preview
  case navigationLink
  case navigationDestination
  case other
}

struct CallSite: Codable {
  var viewName: String
  /// The construction expression lifted verbatim, so the Swift compiler resolves it for us.
  var expression: String
  var context: CallContext
  /// Free identifiers in `expression` that would not resolve at the lift site —
  /// locals, instance properties, `$projections`. Non-empty means not liftable.
  var unresolvedNames: [String]
  /// Free identifiers bound by the enclosing `switch` pattern of a
  /// `navigationDestination` arm. Each one stands for one associated value of the
  /// route case, so the *shape* is liftable; the names are only satisfiable once we
  /// can point at an observed value for them (see `substituted` in main.swift).
  var patternBoundNames: [String]
  /// The route case whose pattern bound `patternBoundNames`, in declaration order.
  var routeType: String?
  var caseName: String?
  var file: String
  var line: Int

  /// Liftable exactly as written: every free name resolves at the lift site.
  var isLiftable: Bool { unresolvedNames.isEmpty && patternBoundNames.isEmpty }
}

/// The rung of the ladder that made a view constructible.
enum Rung: String, Codable, CaseIterable {
  case noParams          // ProfileView()
  case preview           // lifted from #Preview / PreviewProvider
  case callSite          // literal arguments at a NavigationLink site
  case mockStatic        // at least one param took an *observed* static: User.mock,
                         // .sample, .preview, .placeholder() — a value the app wrote down
  case bindingsOnly      // only @Binding and closure params remain
  case skipped
}

/// Where a value we wrote for a parameter came from. The whole point of the tool is that
/// these two are never conflated: an observed static is the app's own statement of what a
/// real value looks like, while a neutral synthesis is our own assertion of absence.
enum Provenance {
  /// A `static let mock` / `static func placeholder()` the app itself declares.
  case observedStatic
  /// `.constant(0)`, `.constant([])`, `.constant("")` — we invented it, but a `Binding` has no
  /// observed value by nature, so supplying one is structural rather than a claim about content.
  /// The same literals are also used for a route case's associated values, where they likewise
  /// only say "nothing". They are never written for a plain initializer parameter: see `classify`.
  case neutralSynthesis
  /// `{ }`, `{ _ in }` — a no-op for a callback the screen owns.
  case emptyClosure
}

struct Resolution: Codable {
  var view: String
  var rung: Rung
  var expression: String?
  var missing: [String]
  var file: String
  var line: Int
  /// Empty when the view looks like a leaf component rather than a screen.
  var screenEvidence: [ScreenEvidence] = []

  var isScreen: Bool { !screenEvidence.isEmpty }
}

struct RouteSummary: Codable {
  var hashableRouteTypes: [String]
  var navigationDestinationTypes: [String]
  var navigationLinkValueCount: Int
  var navigationLinkDestinationCount: Int
}

struct Report: Codable {
  /// The version of this JSON shape. See the invocation contract at the top of `main.swift`:
  /// bumped only when a consumer reading the current shape would misread the new one.
  var contractVersion: Int
  var app: String
  var swiftFiles: Int
  /// Every `struct _: View`, including leaf components.
  var views: Int
  var viewsConstructible: Int
  /// Views we have positive evidence are navigation destinations.
  var screens: Int
  var screensConstructible: Int
  var screenCoverage: Double
  var byRung: [String: Int]
  var routes: RouteSummary
  var routeEdges: [RouteEdge]
  var routeEdgesConstructible: Int
  var resolutions: [Resolution]
}
