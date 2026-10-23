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
  /// What the view reads out of the environment, as declared. See `environmentRequirements`.
  /// This is what the runtime audit checks against the keys actually installed where the screen
  /// was presented — the only mechanism that catches a missing `@Environment` key, because such a
  /// key falls back to `defaultValue` and renders a plausible lie that no screenshot can expose.
  var environmentRequires: [String] = []
  /// Keys this view needs because something in its body reads them, rather than because it declares
  /// them itself — the union over its own children's requirements, transitively, with its own keys
  /// removed so the two stay distinguishable.
  ///
  /// It is a separate field rather than a widening of `environmentRequires` because the two answer
  /// different questions: "what did this view declare" and "what must be installed for this view to
  /// render". A consumer installing an environment wants the union of both; one reporting what the
  /// source says wants only the first. Widening the existing field would have silently changed the
  /// answer to the first question for every consumer already reading it.
  ///
  /// Read lexically, from `childrenByView`, so it inherits that relation's limits: a view
  /// constructed through a generic parameter, a closure the body is handed, or a type alias is not
  /// seen. Over-reporting is the safer direction here — a key named but not needed costs an audit
  /// line, while a key needed but not named renders a plausible lie no screenshot can expose.
  var environmentRequiresTransitive: [String] = []

  var isScreen: Bool { !screenEvidence.isEmpty }

  /// Written out by hand for one reason: `expression` is `nil` for a `skipped` view, and the
  /// synthesized encoder would *omit* the key rather than write `null`. A consumer would then see
  /// a report whose rows have different shapes depending on the rung. The contract says a report
  /// has one shape, so the key is always present.
  func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(view, forKey: .view)
    try container.encode(rung, forKey: .rung)
    try container.encode(expression, forKey: .expression)
    try container.encode(missing, forKey: .missing)
    try container.encode(file, forKey: .file)
    try container.encode(line, forKey: .line)
    try container.encode(screenEvidence, forKey: .screenEvidence)
    try container.encode(environmentRequires, forKey: .environmentRequires)
    try container.encode(environmentRequiresTransitive, forKey: .environmentRequiresTransitive)
  }
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
  /// Navigation relations between views. Adding this field is not a contract bump: a consumer
  /// that does not know it ignores it, which is the documented rule for every added field.
  var viewEdges: [ViewEdge]
  /// The navigation containers each view's body builds, which is what says whether a screen is
  /// tabbed, split or pushed. Nothing else in the report carries shape.
  var navigators: [NavigatorDecl]
  /// Where a journey starts: the `App` declarations and the views their scenes present.
  var appEntries: [AppEntry]
  /// Route values the app writes down at `NavigationLink(value:)` sites, after the enum they belong
  /// to has been resolved. Reported as well as consumed so a run can show what was observed.
  var observedRouteValues: [RouteValueObservation]
  var resolutions: [Resolution]
}
