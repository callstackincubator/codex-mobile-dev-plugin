import Foundation
import SwiftSyntax
import SwiftParser

// MARK: - Source tree walk

let skippedDirs: Set<String> = [
  ".build", ".git", "Pods", "Carthage", "DerivedData", "build",
  // Codegen output is not a parse input. Leaving the generated registry inside the
  // parsed tree fed the previous build's `AnyView(AboutView())` entries back in as
  // call sites -- the parser read its own output. The build system needs that file
  // inside the target's source directory, so the exclusion lives here.
  "Generated",
  "Tests", "Test", "UITests", "Snapshots", "__Snapshots__", "node_modules",
]

func swiftFiles(under root: String) -> [String] {
  var found: [String] = []
  let fm = FileManager.default
  guard let walker = fm.enumerator(atPath: root) else { return [] }
  for case let relative as String in walker {
    let components = relative.split(separator: "/").map(String.init)
    if components.contains(where: { skippedDirs.contains($0) }) {
      walker.skipDescendants()
      continue
    }
    if relative.hasSuffix(".swift") { found.append(root + "/" + relative) }
  }
  return found
}

// MARK: - Ladder

/// `Binding<[TimelineFilter]>` -> `[TimelineFilter]`. The old version stripped *every*
/// `>`, which mangled nested generics such as `Binding<Set<Foo>>`.
func unwrapBinding(_ type: String) -> String {
  let trimmed = type.trimmingCharacters(in: .whitespaces)
  guard trimmed.hasPrefix("Binding<"), trimmed.hasSuffix(">") else { return trimmed }
  return String(trimmed.dropFirst("Binding<".count).dropLast())
    .trimmingCharacters(in: .whitespaces)
}

/// An empty collection is the one aggregate value that cannot misrepresent anything:
/// it asserts absence, which is a state the screen must already handle.
func emptyCollectionLiteral(for type: String) -> String? {
  if type.hasPrefix("["), type.hasSuffix("]") {
    // Top-level `:` distinguishes `[Key: Value]` from `[Element]`.
    var depth = 0
    for character in type.dropFirst().dropLast() {
      if character == "[" || character == "<" || character == "(" { depth += 1 }
      if character == "]" || character == ">" || character == ")" { depth -= 1 }
      if character == ":" && depth == 0 { return "[:]" }
    }
    return "[]"
  }
  if type.hasPrefix("Set<") || type.hasPrefix("Array<") { return "[]" }
  if type.hasPrefix("Dictionary<") { return "[:]" }
  if type.hasPrefix("IdentifiedArrayOf<") || type.hasPrefix("IdentifiedArray<") { return "[]" }
  return nil
}

/// Numeric widths that have a neutral zero. Only ever used for a `Binding`: a binding is
/// parent-owned state that the screen both renders and writes back, and zero / `false` /
/// `""` is the state the parent itself would start from. A *non-defaulted plain*
/// parameter is content the screen was told to display, so there is no neutral value for
/// it and we refuse to invent one — `Date` is excluded everywhere, since no point in time
/// is neutral.
let neutralNumericTypes: Set<String> = [
  "Int", "Int8", "Int16", "Int32", "Int64",
  "UInt", "UInt8", "UInt16", "UInt32", "UInt64",
  "Double", "Float", "CGFloat", "TimeInterval",
]

/// How many parameters a written closure type takes. `{ }` only compiles for a
/// zero-parameter closure: `onSelect: (PHAsset) async -> Void` needs `{ _ in }`. The
/// arity is read off the source text of the type, and when the text cannot be read
/// confidently we return `nil` and refuse the parameter rather than emit something that
/// will not compile.
func closureArity(_ type: String) -> Int? {
  var text = type.trimmingCharacters(in: .whitespaces)
  if text.hasSuffix("?") { text = String(text.dropLast()).trimmingCharacters(in: .whitespaces) }
  // Peel redundant wrapping parens: `((Int) -> Void)` -> `(Int) -> Void`.
  while text.hasPrefix("("), text.hasSuffix(")"), balancedWrapper(text) {
    text = String(text.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
    if text.hasSuffix("?") { text = String(text.dropLast()).trimmingCharacters(in: .whitespaces) }
  }
  // An escaping/Sendable/etc. attribute prefix is harmless; drop it.
  while text.hasPrefix("@") {
    guard let space = text.firstIndex(of: " ") else { return nil }
    text = String(text[text.index(after: space)...]).trimmingCharacters(in: .whitespaces)
  }
  // A generic parameter type such as `Content` or a typealias hides the shape entirely.
  guard let arrow = topLevelArrowIndex(text) else { return nil }
  var params = String(text[text.startIndex..<arrow]).trimmingCharacters(in: .whitespaces)
  // `(Int) async throws -> Void`: effect specifiers sit between the list and the arrow.
  while let space = params.lastIndex(of: " "), !params.hasSuffix(")") {
    params = String(params[params.startIndex..<space]).trimmingCharacters(in: .whitespaces)
  }
  guard params.hasPrefix("("), params.hasSuffix(")") else { return nil }
  let inner = String(params.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
  if inner.isEmpty { return 0 }
  // A variadic parameter still binds exactly one name in the closure signature, so the
  // count of top-level commas is the arity either way.
  var depth = 0
  var count = 1
  for character in inner {
    if character == "(" || character == "[" || character == "<" { depth += 1 }
    if character == ")" || character == "]" || character == ">" { depth -= 1 }
    if character == "," && depth == 0 { count += 1 }
  }
  return count
}

/// True when the outermost `(` of `text` is closed by its final `)`.
private func balancedWrapper(_ text: String) -> Bool {
  var depth = 0
  for (offset, character) in text.enumerated() {
    if character == "(" { depth += 1 }
    if character == ")" {
      depth -= 1
      if depth == 0 { return offset == text.count - 1 }
    }
  }
  return false
}

/// Index of the `->` that separates a function type's parameters from its result,
/// ignoring arrows nested inside parentheses or generic brackets.
private func topLevelArrowIndex(_ text: String) -> String.Index? {
  var depth = 0
  var index = text.startIndex
  while index < text.endIndex {
    let character = text[index]
    if character == "(" || character == "[" || character == "<" { depth += 1 }
    if character == ")" || character == "]" || character == ">" { depth -= 1 }
    if depth == 0, character == "-", text.index(after: index) < text.endIndex,
       text[text.index(after: index)] == ">" {
      return index
    }
    index = text.index(after: index)
  }
  return nil
}

/// A no-op closure literal of the right shape, or `nil` when the shape is unreadable.
func emptyClosureLiteral(for type: String) -> String? {
  guard let arity = closureArity(type) else { return nil }
  if arity == 0 { return "{ }" }
  return "{ " + Array(repeating: "_", count: arity).joined(separator: ", ") + " in }"
}

/// A value we can write for a param without ever observing a real one, together with
/// where it came from — the caller needs the provenance to report an honest rung.
func syntheticValue(
  for param: ParamInfo, mocks: [String: String]
) -> (value: String, provenance: Provenance)? {
  if param.isClosure {
    // A `@ViewBuilder` parameter is also written `() -> Content`, so arity 0 covers it
    // and `{ }` infers `EmptyView`. A closure whose written type we cannot read — a
    // generic `Content`, a typealias — is refused rather than guessed at.
    guard let literal = emptyClosureLiteral(for: param.type) else { return nil }
    return (literal, .emptyClosure)
  }

  let bare = unwrapBinding(param.type)

  if param.isBinding {
    if bare.hasSuffix("?") || bare.hasPrefix("Optional<") {
      return (".constant(nil)", .neutralSynthesis)
    }
    if let empty = emptyCollectionLiteral(for: bare) {
      return (".constant(\(empty))", .neutralSynthesis)
    }
    switch bare {
    case "Bool": return (".constant(false)", .neutralSynthesis)
    case "String": return (".constant(\"\")", .neutralSynthesis)
    default:
      // A `Binding` is written back to, so a neutral number is safe where a bare
      // numeric parameter would also be; anything richer is left to `missing`.
      if neutralNumericTypes.contains(bare) { return (".constant(0)", .neutralSynthesis) }
      if let member = mocks[bare] { return (".constant(.\(member))", .observedStatic) }
      return nil
    }
  }

  if let member = mocks[bare] { return (".\(member)", .observedStatic) }
  // `nil` / `[]` for a *plain* parameter. `classify` refuses this provenance outright, so the
  // only caller that accepts it is `substitutedCallSite`, where the value stands for a route
  // case's associated value rather than for content the screen was told to display.
  if bare.hasSuffix("?") || bare.hasPrefix("Optional<") { return ("nil", .neutralSynthesis) }
  if let empty = emptyCollectionLiteral(for: bare) { return (empty, .neutralSynthesis) }
  return nil
}

/// Rewrites the free identifiers a `switch` pattern bound into values observed elsewhere.
/// Done on the parsed expression rather than by string replacement so that, say, a bound
/// `list` never corrupts `pinnedFilters` or `.list(list:)`'s own argument label.
final class IdentifierSubstitution: SyntaxRewriter {
  let values: [String: String]
  var unsatisfied: Set<String> = []

  init(values: [String: String]) {
    self.values = values
    super.init()
  }

  override func visit(_ node: DeclReferenceExprSyntax) -> ExprSyntax {
    let name = node.baseName.text
    guard let replacement = values[name] else { return ExprSyntax(node) }
    guard let parsed = Parser.parse(source: replacement).statements.first?.item.as(ExprSyntax.self)
    else {
      unsatisfied.insert(name)
      return ExprSyntax(node)
    }
    return parsed.with(\.leadingTrivia, node.leadingTrivia)
      .with(\.trailingTrivia, node.trailingTrivia)
  }
}

/// A `navigationDestination` arm such as
///
///     case .hashTag(let tag, let accountId):
///       TimelineView(timeline: .constant(.hashtag(tag: tag, accountId: accountId)), ...)
///
/// is the most informative construction the app contains: the author wrote the exact
/// shape the screen needs. Only `tag` and `accountId` stand in the way, and each one *is*
/// one associated value of the route case — so the expression is liftable precisely when
/// we can name an observed value for every one of them.
///
/// "Observed" is the whole rule: the substitute must be a value the app itself declares
/// (a `.mock` / `.sample` / `.preview` static on the associated type), a value the app writes
/// down at a `NavigationLink(value:)` site for this very case, or a value that
/// cannot misrepresent anything (an empty collection, a `nil` optional). A `String`
/// hashtag or an `Int` id has no such value of its own — `""` would make the screen render a lookup
/// failure dressed as content — so a name with none of the three goes to `missing` and the view
/// stays `skipped`. We never fabricate a route associated value to make a screen reachable.
///
/// `observed` is preferred over a synthesis for the same reason the ladder prefers a route
/// destination over an init: the app wrote `Route.orderDetail("A-1042")` and meant it, where `nil`
/// or `[]` is only ever our own statement that there is nothing.
func substitutedCallSite(
  _ site: CallSite,
  enumCases: [String: [String: [String]]],
  mocks: [String: String],
  observed: [String: [String: [String]]] = [:]
) -> (expression: String, missing: [String])? {
  guard site.unresolvedNames.isEmpty, !site.patternBoundNames.isEmpty else { return nil }
  guard let routeType = site.routeType, let caseName = site.caseName,
        let associated = enumCases[routeType]?[caseName],
        associated.count == site.patternBoundNames.count
  else {
    // Shape is liftable but we cannot say what the bound names stand for.
    return (site.expression, site.patternBoundNames.map { "\($0): <unknown route value>" })
  }

  // An observation only applies when it carries one value per bound name; a shorter list would
  // leave a name standing and a longer one means we matched the wrong case.
  let written = observed[routeType]?[caseName]
  let observedArguments = written?.count == associated.count ? written : nil

  var values: [String: String] = [:]
  var missing: [String] = []
  for (index, (name, type)) in zip(site.patternBoundNames, associated).enumerated() {
    if let observedArguments {
      values[name] = observedArguments[index]
      continue
    }
    let param = ParamInfo(
      label: name, type: type, hasDefault: false,
      isBinding: false, isClosure: type.contains("->")
    )
    if let synthetic = syntheticValue(for: param, mocks: mocks) {
      values[name] = synthetic.value
    } else {
      missing.append("\(routeType).\(caseName)(\(name): \(type))")
    }
  }
  guard missing.isEmpty else { return (site.expression, missing) }

  guard let parsed = Parser.parse(source: site.expression)
    .statements.first?.item.as(ExprSyntax.self)
  else { return (site.expression, site.patternBoundNames.map { "\($0): <unparsed>" }) }
  let rewriter = IdentifierSubstitution(values: values)
  let rewritten = rewriter.visit(parsed).trimmedDescription
  guard rewriter.unsatisfied.isEmpty else {
    return (site.expression, rewriter.unsatisfied.sorted())
  }
  return (rewritten, [])
}

func classify(
  _ view: ViewDecl,
  callSites: [String: [CallSite]],
  mocks: [String: String],
  enumCases: [String: [String: [String]]],
  observedRouteValues: [String: [String: [String]]] = [:]
) -> Resolution {
  func resolved(_ rung: Rung, _ expression: String) -> Resolution {
    Resolution(view: view.name, rung: rung, expression: expression,
               missing: [], file: view.file, line: view.line)
  }

  let required = view.params.filter { !$0.hasDefault }

  // Rung 1 — nothing to supply.
  if required.isEmpty { return resolved(.noParams, "\(view.name)()") }

  let sites = callSites[view.name] ?? []

  // Rung 2 — lift a preview's construction expression verbatim. A `#Preview` body is
  // *not* automatically liftable: it may reference a local declared earlier in the
  // preview block, a `@Previewable @State`, or the preview type's own members, none of
  // which exist at the lift site. The same free-identifier check the `callSite` rung
  // uses decides it. Multi-statement previews need no special case: a `let` bound in
  // the preview block shows up as a free identifier in the construction that uses it,
  // so such a preview is rejected exactly when the construction actually depends on it
  // and lifted when it does not.
  if let preview = sites.first(where: { $0.context == .preview && $0.isLiftable }) {
    return resolved(.preview, preview.expression)
  }

  // Rung 3 — a call site that is liftable as written, i.e. every free identifier in it
  // resolves at the lift site. Prefer a route destination: the router is the app's own
  // statement of how the screen is entered.
  let liftable = sites.filter { $0.isLiftable && !$0.expression.isEmpty }
  if let site = liftable.first(where: { $0.context == .navigationDestination })
    ?? liftable.first(where: { $0.context == .navigationLink })
    ?? liftable.first {
    return resolved(.callSite, site.expression)
  }

  // Rung 3b — a route arm whose only free names are the route case's own associated
  // values, each of which we can point at an observed value for.
  var routeShapeMissing: [String]?
  for site in sites where site.context == .navigationDestination {
    guard let attempt = substitutedCallSite(
      site, enumCases: enumCases, mocks: mocks, observed: observedRouteValues
    ) else { continue }
    if attempt.missing.isEmpty { return resolved(.callSite, attempt.expression) }
    if routeShapeMissing == nil { routeShapeMissing = attempt.missing }
  }

  // Rung 4 — supply only values the app itself wrote down, plus the structural ones.
  var arguments: [String] = []
  var missing: [String] = []
  var observedMock = false
  for param in required {
    guard let synthetic = syntheticValue(for: param, mocks: mocks) else {
      missing.append("\(param.label): \(param.type)")
      continue
    }
    switch synthetic.provenance {
    case .observedStatic:
      observedMock = true
    case .neutralSynthesis:
      // A neutral `Binding` is parent-owned state the screen writes back to, and
      // `bindingsOnly` reports exactly that: the value is structural, not a claim.
      //
      // A neutral *plain* parameter is a different thing entirely. It is content the screen
      // was told to display, and `[]` / `nil` is our own assertion that there is none — a
      // value the app never wrote down. The parameter is therefore refused and the view goes
      // to `skipped` with the type recorded, rather than rendering an invented empty state.
      if !param.isBinding {
        missing.append("\(param.label): \(param.type)")
        continue
      }
    case .emptyClosure:
      break
    }
    arguments.append("\(param.label): \(synthetic.value)")
  }

  if missing.isEmpty {
    return resolved(observedMock ? .mockStatic : .bindingsOnly,
                    "\(view.name)(\(arguments.joined(separator: ", ")))")
  }

  // The router already wrote a correct construction for this screen; what blocks it is
  // the route's own associated values. Naming those is more actionable than naming the
  // init parameters, so prefer them.
  return Resolution(view: view.name, rung: .skipped, expression: nil,
                    missing: routeShapeMissing ?? missing,
                    file: view.file, line: view.line)
}

// MARK: - Invocation contract
//
// This is the seam the TypeScript side runs the parser through, and the one thing that must stay
// stable while the *producer* behind it changes — built from source today, shipped prebuilt later,
// supplemented by SourceKit after that. Holding it still is what makes that swap a packaging
// change rather than a rewrite of codegen and the orchestrator, so every line below is a promise:
//
//   swift-appflow-parse <source-root> [--quiet]
//
//   stdout   exactly one JSON object, a `Report`, and nothing else. Always valid JSON on exit 0.
//   stderr   a human summary, diagnostics, and errors. Never machine-read; `--quiet` silences the
//            summary but not errors.
//   exit 0   a report was produced. A root holding no Swift at all is still a report (`views: 0`),
//            not a failure: "this app has no screens" and "the parser broke" must not look alike.
//   exit 2   usage error — no root, unknown flag. Nothing on stdout.
//   exit 3   the root does not exist or cannot be read. Nothing on stdout.
//
//   --version  prints `{"tool":..,"contractVersion":..}` to stdout and exits 0, without a root.
//              Consumers check `contractVersion` before trusting the report's shape.
//
// `contractVersion` is bumped only when a consumer that reads the current shape would misread the
// new one: a field removed, a field's meaning changed, an enum case removed. Adding a field is not
// a bump — consumers must ignore what they do not know.
//
// Contract 1 removed the `synthesized` rung, so `byRung` no longer carries that key. Every
// `resolutions` row has the same keys whatever its rung: `expression` is explicitly `null` for a
// `skipped` view rather than absent.
//
// Added since, without a bump, because each is a new key beside the old ones rather than a change
// to one: `navigators`, `appEntries`, `observedRouteValues`, and `environmentRequiresTransitive` on
// every `resolutions` row. In particular `environmentRequires` still means exactly what it did —
// the keys the view declares itself — and the transitive ones arrive in their own field, so a
// consumer reading only the old field reads the same answer it did before.

let contractVersion = 1
let toolName = "swift-appflow-parse"

func fail(_ message: String, code: Int32) -> Never {
  FileHandle.standardError.write(Data("\(toolName): \(message)\n".utf8))
  exit(code)
}

let usage = """
usage: \(toolName) <source-root> [--quiet]
       \(toolName) --version

  <source-root>  directory to walk for .swift files
  --quiet        suppress the human summary on stderr
  --version      print the stdout JSON contract version and exit

exit codes: 0 report on stdout · 2 usage · 3 source root unreadable
"""

var root: String?
var quiet = false
for argument in CommandLine.arguments.dropFirst() {
  switch argument {
  case "--version":
    FileHandle.standardOutput.write(
      Data("{\"tool\":\"\(toolName)\",\"contractVersion\":\(contractVersion)}\n".utf8))
    exit(0)
  case "--help", "-h":
    FileHandle.standardOutput.write(Data((usage + "\n").utf8))
    exit(0)
  case "--quiet":
    quiet = true
  default:
    // A second positional is a mistake worth naming rather than silently ignoring: the common
    // version of it is an unquoted path containing a space.
    guard !argument.hasPrefix("-"), root == nil else {
      FileHandle.standardError.write(Data((usage + "\n").utf8))
      fail("unexpected argument '\(argument)'", code: 2)
    }
    root = argument
  }
}

guard let root else {
  FileHandle.standardError.write(Data((usage + "\n").utf8))
  exit(2)
}

// Checked up front so an unreadable root is exit 3 with a sentence, rather than exit 0 with an
// empty report that reads as "this app has no screens".
var rootIsDirectory: ObjCBool = false
guard FileManager.default.fileExists(atPath: root, isDirectory: &rootIsDirectory) else {
  fail("source root does not exist: \(root)", code: 3)
}
guard rootIsDirectory.boolValue else {
  fail("source root is not a directory: \(root)", code: 3)
}
guard FileManager.default.isReadableFile(atPath: root) else {
  fail("source root is not readable: \(root)", code: 3)
}

// MARK: - Entry point

let collection = Collection()
let files = swiftFiles(under: root)
collection.fileCount = files.count

for path in files {
  guard let source = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
  let tree = Parser.parse(source: source)
  let relative = path.hasPrefix(root + "/") ? String(path.dropFirst(root.count + 1)) : path
  Collector(file: relative, tree: tree, into: collection).walk(tree)
}

// A `NavigationLink(value: .orderDetail("A-1042"))` leaves the enum to inference, so the type is
// recovered from the declarations instead — and only when exactly one enum declares that case with
// a matching number of associated values. Two enums with a `detail` case make the site ambiguous,
// and an ambiguous observation is no observation at all.
let observedRouteValues: [RouteValueObservation] = collection.observedRouteValues.compactMap {
  observation in
  if observation.routeType != nil { return observation }
  let owners = collection.enumCases.filter { _, cases in
    cases[observation.caseName]?.count == observation.arguments.count
  }.keys
  guard owners.count == 1, let owner = owners.first else { return nil }
  var resolved = observation
  resolved.routeType = owner
  return resolved
}

// Route type -> case -> the arguments written down for it. A case written at two sites with
// different values keeps the first: both are observed, and picking one is not a claim about
// content the way synthesising one would be.
var observedByRoute: [String: [String: [String]]] = [:]
for observation in observedRouteValues {
  guard let routeType = observation.routeType else { continue }
  if observedByRoute[routeType]?[observation.caseName] == nil {
    observedByRoute[routeType, default: [:]][observation.caseName] = observation.arguments
  }
}

// An `App` body builds more than views — `RouterPath()`, `Task { }`, a model container — and the
// collector cannot tell them apart while walking, because the view declarations may be in files it
// has not reached yet. Filtering against the declarations afterwards is the only point where that
// is knowable, so an entry is a view the app really declares or it is not reported at all.
// An `App`'s scenes are routinely written in an extension — IceCubesApp's is
// `extension IceCubesApp { var appScene: some Scene { WindowGroup { AppView(...) } } }` — which the
// struct's own member block does not contain. The scene containers are collected separately,
// attributed to the type they are written on, so an extension's scene reaches its own `App` here.
//
// Filtered against the declarations because a scene body constructs more than views, and the
// collector cannot tell them apart while walking: the view declarations may be in files it has not
// reached yet. This is the only point where that is knowable.
let declaredViews = Set(collection.views.map(\.name))
let appEntries: [AppEntry] = collection.appEntries.map { entry in
  var entry = entry
  entry.entryViews = (collection.sceneEntries[entry.name] ?? []).filter {
    declaredViews.contains($0)
  }
  return entry
}

// An entry is where a journey starts, which is the strongest screen evidence there is. Marked here
// rather than during the walk, because the entry is only known once the declarations are: a root
// named as an entry and then left without a node would be a journey starting nowhere.
for entry in appEntries {
  for view in entry.entryViews { collection.markScreen(view, .appRoot) }
}

let sitesByView = Dictionary(grouping: collection.callSites, by: \.viewName)
var resolutions = collection.views
  .map {
    classify($0, callSites: sitesByView, mocks: collection.mockStaticsByType,
             enumCases: collection.enumCases, observedRouteValues: observedByRoute)
  }

/// Every environment key a view needs because something beneath it reads one.
///
/// A screen's children render inside the environment the screen was presented in, so a key a child
/// declares is a key the presentation must install. Walked as a closure over `childrenByView`
/// rather than a single hop, because the child that reads the key is routinely two or three
/// components down. Cycle-safe by construction: a view already visited contributes nothing twice,
/// and mutual recursion between two views' bodies terminates on the visited set rather than
/// recursing forever.
func transitiveEnvironment(
  of view: String,
  children: [String: [String]],
  own: [String: [String]]
) -> [String] {
  var visited: Set<String> = [view]
  var queue = children[view] ?? []
  var found: [String] = []
  while !queue.isEmpty {
    let next = queue.removeFirst()
    guard visited.insert(next).inserted else { continue }
    for key in own[next] ?? [] where !found.contains(key) { found.append(key) }
    queue.append(contentsOf: children[next] ?? [])
  }
  let declared = Set(own[view] ?? [])
  return found.filter { !declared.contains($0) }
}

for index in resolutions.indices {
  let view = resolutions[index].view
  resolutions[index].screenEvidence =
    (collection.screenEvidence[view] ?? []).sorted { $0.rawValue < $1.rawValue }
  resolutions[index].environmentRequires = collection.environmentRequires[view] ?? []
  resolutions[index].environmentRequiresTransitive = transitiveEnvironment(
    of: view, children: collection.childrenByView, own: collection.environmentRequires
  )
}
resolutions.sort { ($0.rung.rawValue, $0.view) < ($1.rung.rawValue, $1.view) }

let screens = resolutions.filter(\.isScreen)
var byRung: [String: Int] = [:]
for rung in Rung.allCases { byRung[rung.rawValue] = 0 }
for screen in screens { byRung[screen.rung.rawValue, default: 0] += 1 }

// Fill associated value types now that every enum declaration has been seen,
// then ask whether the *route value* is constructible (usually far easier than
// the destination view's own init).
let routeEdges: [RouteEdge] = collection.routeEdges.map { edge in
  var edge = edge
  edge.associatedTypes = collection.enumCases[edge.routeType]?[edge.caseName] ?? []
  return edge
}
let routeEdgesConstructible = routeEdges.count { edge in
  edge.associatedTypes.allSatisfy { type in
    syntheticValue(
      for: ParamInfo(label: "_", type: type, hasDefault: false,
                     isBinding: false, isClosure: type.contains("->")),
      mocks: collection.mockStaticsByType
    )?.value != nil || ["String", "Int", "Double", "Bool", "UUID"].contains(type)
  }
}

let screensConstructible = screens.count { $0.rung != .skipped }
let report = Report(
  contractVersion: contractVersion,
  app: (root as NSString).lastPathComponent,
  swiftFiles: collection.fileCount,
  views: resolutions.count,
  viewsConstructible: resolutions.count { $0.rung != .skipped },
  screens: screens.count,
  screensConstructible: screensConstructible,
  screenCoverage: screens.isEmpty ? 0 : Double(screensConstructible) / Double(screens.count),
  byRung: byRung,
  routes: RouteSummary(
    hashableRouteTypes: collection.hashableEnums.sorted(),
    navigationDestinationTypes: collection.navigationDestinationTypes.sorted(),
    navigationLinkValueCount: collection.navLinkValueCount,
    navigationLinkDestinationCount: collection.navLinkDestinationCount
  ),
  routeEdges: routeEdges,
  routeEdgesConstructible: routeEdgesConstructible,
  viewEdges: collection.viewEdges,
  navigators: collection.navigators,
  appEntries: appEntries,
  observedRouteValues: observedRouteValues,
  resolutions: resolutions
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
guard let encoded = try? encoder.encode(report) else {
  fail("could not encode report", code: 3)
}
FileHandle.standardOutput.write(encoded)

let summary = """

\(report.app) — \(report.swiftFiles) files, \(report.views) views
  screens: \(screensConstructible)/\(screens.count) constructible \
(\(Int(report.screenCoverage * 100))%)
  rungs:   \(Rung.allCases.map { "\($0.rawValue)=\(byRung[$0.rawValue] ?? 0)" }
              .joined(separator: " "))
  routes:  \(routeEdgesConstructible)/\(routeEdges.count) route edges constructible, \
\(report.routes.navigationLinkValueCount) NavigationLink(value:), \
\(report.routes.navigationLinkDestinationCount) NavigationLink(destination:)
  shape:   \(report.navigators.count) navigators, \(report.appEntries.count) app entries, \
\(observedRouteValues.count) observed route values

"""
if !quiet { FileHandle.standardError.write(Data(summary.utf8)) }
