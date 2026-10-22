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

/// Why we believe a view is a screen rather than a leaf component.
enum ScreenEvidence: String, Codable {
  case navigationDestination
  case navigationLink
  case sheet
  case appRoot
  case navigationTitle
}
