import Foundation

/// One `case .accountDetail(let id): AccountDetailView(accountId: id)` arm of a
/// `navigationDestination(for:)` switch — i.e. one edge of the navigation graph.
struct RouteEdge: Codable {
  var routeType: String
  var caseName: String
  /// Associated value types carried by the route case, e.g. `["String"]`.
  var associatedTypes: [String]
  var destinationView: String
  /// The destination construction lifted verbatim from source.
  var expression: String
  var file: String
  var line: Int
}

/// How one view reaches another, as the source declares it.
///
/// `push` and `modal` are true `from -> to` relations: the construction is lexically inside the
/// body of `from`, so that view really does present `to`. `route` is weaker and deliberately kept
/// apart from them -- the arm of a `navigationDestination(for:)` switch is declared on whichever
/// view hosts the `NavigationStack`, not on the screen the user was looking at when the path was
/// appended, and nothing in the source says which screen that was. A consumer that wants only
/// relations a user could trace should read `push` and `modal` and leave `route` alone.
enum ViewEdgeKind: String, Codable {
  case push
  case modal
  case route
}

/// One navigation relation lifted verbatim from a view's body.
struct ViewEdge: Codable {
  /// The type whose body declares the construction. Never inferred: an edge with no enclosing
  /// type declaration is not recorded at all.
  var from: String
  var to: String
  var kind: ViewEdgeKind
  /// The presenting modifier or initializer as written, e.g. `sheet` or `NavigationLink`.
  var via: String
  var file: String
  var line: Int
}

/// The shape a navigation container gives the screens under it.
///
/// Named after what the container *is*, not after what a consumer calls it: mapping `tabs` onto a
/// particular layout name is the consumer's decision, and keeping the source's own word here means
/// a later mapping change is not a contract change.
enum NavigatorKind: String, Codable {
  case tabs            // TabView
  case splitView       // NavigationSplitView
  case stack           // NavigationStack / NavigationView
}

/// One navigation container, attributed to the view whose body constructs it.
///
/// `view` is read lexically, the same way `ViewEdge.from` is. A container constructed outside any
/// type declaration is not recorded, because the view it shapes cannot be named.
struct NavigatorDecl: Codable {
  var view: String
  var kind: NavigatorKind
  /// The container as written, e.g. `TabView` or `NavigationView`.
  var via: String
  var file: String
  var line: Int
}

/// An `App` (or `Scene`) declaration and what its scene bodies present.
///
/// `entryViews` is where a journey starts, which nothing else in the report says. Scene containers
/// (`WindowGroup`, `Settings`, …) and layout containers are skipped, so these are the first views
/// the app actually shows rather than the windows it shows them in.
struct AppEntry: Codable {
  var name: String
  var entryViews: [String]
  var file: String
  var line: Int
}

/// A route value the app itself writes down at a `NavigationLink(value:)` site.
///
/// `NavigationLink(value: Route.orderDetail("A-1042"))` is the app stating a real value for a route
/// case whose destination arm binds it as a pattern name. Harvesting it is observation, not
/// invention — which is the whole difference between satisfying a destination and fabricating one.
/// Only arguments that would compile at a lift site are recorded; anything referencing a local or
/// an instance property is dropped rather than guessed at.
struct RouteValueObservation: Codable {
  /// `nil` when the site wrote `.orderDetail(...)` with the type left to inference. The enum is
  /// then recovered after the walk, and only when exactly one declares that case.
  var routeType: String?
  var caseName: String
  /// The associated values as written, in declaration order.
  var arguments: [String]
  var file: String
  var line: Int
}

/// Why we believe a view is a screen rather than a leaf component.
enum ScreenEvidence: String, Codable {
  case navigationDestination
  case navigationLink
  case sheet
  case appRoot
  case navigationTitle
}
