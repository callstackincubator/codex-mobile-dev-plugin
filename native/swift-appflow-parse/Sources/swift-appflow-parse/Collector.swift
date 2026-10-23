import Foundation
import SwiftSyntax
import SwiftParser

/// SwiftUI's own layout and navigation containers.
///
/// A sheet's content is routinely wrapped in one (`.sheet { NavigationStack { EditorView() } }`),
/// and the first construction inside the closure is then the wrapper, not the destination. Every
/// read of "what is presented here" skips them, so both the edge and the screen name the view
/// rather than the box it arrived in. This used to be scoped to edge destinations only, which left
/// the wrapper inflating `screens` and minting a node of its own; the wrapper is not a screen in
/// either reading, so the same list now governs both.
private let swiftUIContainers: Set<String> = [
  "NavigationStack", "NavigationView", "NavigationSplitView", "TabView", "Group",
  "VStack", "HStack", "ZStack", "LazyVStack", "LazyHStack", "LazyVGrid", "LazyHGrid",
  "List", "Form", "Section", "ScrollView", "GeometryReader", "AnyView",
]

/// The scene types an `App` body is made of. They stand to an `App` exactly as the containers
/// above stand to a sheet's content: `WindowGroup { RootView() }` presents `RootView`, and
/// marking `WindowGroup` itself as a screen names the window rather than what is in it.
private let sceneContainers: Set<String> = [
  "WindowGroup", "Window", "Settings", "DocumentGroup", "MenuBarExtra", "WindowGroupSettings",
]

/// Property wrappers whose storage SwiftUI resolves at runtime — never an init requirement.
private let runtimeResolvedWrappers: Set<String> = [
  "State", "StateObject", "Environment", "EnvironmentObject", "FocusState",
  "AppStorage", "SceneStorage", "GestureState", "Namespace", "FetchRequest",
  "Query", "Bindable",
]

/// Everything one pass over the source tree gathers.
final class Collection {
  var views: [ViewDecl] = []
  var callSites: [CallSite] = []
  var routeEdges: [RouteEdge] = []
  var viewEdges: [ViewEdge] = []
  /// enum name -> case name -> associated value types.
  var enumCases: [String: [String: [String]]] = [:]
  var hashableEnums: Set<String> = []
  var navigationDestinationTypes: Set<String> = []
  var mockStaticsByType: [String: String] = [:]
  var screenEvidence: [String: Set<ScreenEvidence>] = [:]
  /// view name -> what it reads out of the environment. See `environmentRequirements`.
  var environmentRequires: [String: [String]] = [:]
  /// view name -> the view types its own body constructs, in source order with duplicates
  /// dropped. A child reads the environment of whoever presented its parent, so this is the
  /// edge set the transitive environment closure walks. Lexical and observed: a construction
  /// counts for the type whose body encloses it, exactly as `viewEdges` reads `from`.
  var childrenByView: [String: [String]] = [:]
  /// Every navigation container a view's body constructs. See `NavigatorDecl`.
  var navigators: [NavigatorDecl] = []
  /// The `App`/`Scene` declarations, with `entryViews` filled in after the walk from `sceneEntries`.
  var appEntries: [AppEntry] = []
  /// Type name -> the views its scene containers present, in source order. See `recordSceneEntry`.
  var sceneEntries: [String: [String]] = [:]
  /// Route values written down at a `NavigationLink(value:)` site. See `RouteValueObservation`.
  var observedRouteValues: [RouteValueObservation] = []
  var navLinkValueCount = 0
  var navLinkDestinationCount = 0
  var fileCount = 0

  func markScreen(_ view: String, _ evidence: ScreenEvidence) {
    screenEvidence[view, default: []].insert(evidence)
  }
}

final class Collector: SyntaxVisitor {
  private let file: String
  private let locator: SourceLocationConverter
  private let out: Collection
  private var previewDepth = 0

  init(file: String, tree: SourceFileSyntax, into out: Collection) {
    self.file = file
    self.locator = SourceLocationConverter(fileName: file, tree: tree)
    self.out = out
    super.init(viewMode: .sourceAccurate)
  }

  private func line(_ node: some SyntaxProtocol) -> Int {
    locator.location(for: node.position).line
  }

  // MARK: - Preview regions

  override func visit(_ node: MacroExpansionDeclSyntax) -> SyntaxVisitorContinueKind {
    if node.macroName.text == "Preview" { previewDepth += 1 }
    return .visitChildren
  }

  override func visitPost(_ node: MacroExpansionDeclSyntax) {
    if node.macroName.text == "Preview" { previewDepth -= 1 }
  }

  /// A `#Preview { ... }` written at file scope (or anywhere a statement is expected)
  /// parses as a freestanding *expression* macro, not a declaration macro, so tracking
  /// only `MacroExpansionDeclSyntax` misses it and its constructions get filed under
  /// `other` instead of `preview`.
  override func visit(_ node: MacroExpansionExprSyntax) -> SyntaxVisitorContinueKind {
    if node.macroName.text == "Preview" { previewDepth += 1 }
    return .visitChildren
  }

  override func visitPost(_ node: MacroExpansionExprSyntax) {
    if node.macroName.text == "Preview" { previewDepth -= 1 }
  }

  override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
    if isPreviewsProperty(node) { previewDepth += 1 }
    noteMockStatic(node)
    return .visitChildren
  }

  override func visit(_ node: FunctionDeclSyntax) -> SyntaxVisitorContinueKind {
    noteMockStaticFunc(node)
    return .visitChildren
  }

  override func visitPost(_ node: VariableDeclSyntax) {
    if isPreviewsProperty(node) { previewDepth -= 1 }
  }

  private func isPreviewsProperty(_ node: VariableDeclSyntax) -> Bool {
    guard node.modifiers.contains(where: { $0.name.text == "static" }) else { return false }
    return node.bindings.contains { $0.pattern.trimmedDescription == "previews" }
  }

  /// Names an app uses by convention for "a real value of this type, written down".
  private static let mockNames: Set<String> = [
    "mock", "sample", "preview", "example", "placeholder",
  ]

  /// `static let mock = User(...)` on some type — the convention rung.
  private func noteMockStatic(_ node: VariableDeclSyntax) {
    guard node.modifiers.contains(where: { $0.name.text == "static" }) else { return }
    guard let owner = enclosingTypeName(of: node) else { return }
    for binding in node.bindings {
      let name = binding.pattern.trimmedDescription
      guard Self.mockNames.contains(name) else { continue }
      // A written annotation is the type we actually get; `static let mock: Account`
      // in `extension Account.Preview` would otherwise be filed under the wrong type.
      let type = binding.typeAnnotation?.type.trimmedDescription ?? owner
      out.mockStaticsByType[type] = name
    }
  }

  /// `public static func placeholder() -> Account` is the same observation as
  /// `static let mock`, written as a function. It qualifies only when it is callable
  /// with *no* arguments: a static func with a required parameter would force us to
  /// invent that argument, which is exactly what this tool refuses to do.
  private func noteMockStaticFunc(_ node: FunctionDeclSyntax) {
    guard node.modifiers.contains(where: { $0.name.text == "static" }) else { return }
    let name = node.name.text
    guard Self.mockNames.contains(name) else { return }
    let parameters = node.signature.parameterClause.parameters
    guard parameters.allSatisfy({ $0.defaultValue != nil || $0.ellipsis != nil })
    else { return }
    // `async`/`throws` cannot be written in an argument position without extra syntax
    // the lift site may not permit, so we decline rather than emit something uncompilable.
    guard node.signature.effectSpecifiers == nil else { return }
    guard let returned = node.signature.returnClause?.type.trimmedDescription
      ?? enclosingTypeName(of: node) else { return }
    out.mockStaticsByType[returned] = "\(name)()"
  }

  /// The first construction that is a plausible screen rather than a SwiftUI container.
  ///
  /// Returns the call as well as the name, because the caller needs both: the name to mark the
  /// screen, the call to record the construction expression the screen would be lifted from.
  private func firstPresented(
    in root: Syntax, skipping containers: Set<String> = swiftUIContainers
  ) -> (String, FunctionCallExprSyntax)? {
    allConstructions(in: root).first { !containers.contains($0.0) }
  }

  private func firstDestination(in root: Syntax) -> String? {
    firstPresented(in: root)?.0
  }

  /// Records `from -> to`, where `from` is the type whose body lexically contains the call.
  ///
  /// Inside a `#Preview` nothing is recorded: a preview constructs screens to show them, not to
  /// navigate to them, and the enclosing type there is the preview's own macro expansion rather
  /// than a view the user can be on. An edge with no enclosing type is dropped for the same
  /// reason -- a `from` we cannot read is a `from` we would have to invent.
  private func recordViewEdge(
    to destination: String, kind: ViewEdgeKind, via: String, at node: FunctionCallExprSyntax
  ) {
    guard previewDepth == 0, let from = enclosingTypeName(of: node), from != destination else { return }
    out.viewEdges.append(ViewEdge(
      from: from, to: destination, kind: kind, via: via, file: file, line: line(node)
    ))
  }

  private func enclosingTypeName(of node: some SyntaxProtocol) -> String? {
    var current = node.parent
    while let n = current {
      if let s = n.as(StructDeclSyntax.self) { return s.name.text }
      if let c = n.as(ClassDeclSyntax.self) { return c.name.text }
      if let e = n.as(EnumDeclSyntax.self) { return e.name.text }
      if let ext = n.as(ExtensionDeclSyntax.self) { return ext.extendedType.trimmedDescription }
      current = n.parent
    }
    return nil
  }

  // MARK: - Declarations

  override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind {
    if conforms(node.inheritanceClause, to: "App") || conforms(node.inheritanceClause, to: "Scene") {
      // `entryViews` is filled after the walk: the scenes are routinely written in an extension in
      // another file, which this member block does not contain. See `recordSceneEntry`.
      out.appEntries.append(AppEntry(
        name: node.name.text, entryViews: [], file: file, line: line(node)
      ))
    }
    guard conforms(node.inheritanceClause, to: "View") else { return .visitChildren }
    let explicitInit = node.memberBlock.members.compactMap {
      $0.decl.as(InitializerDeclSyntax.self)
    }.first { !$0.modifiers.contains { m in m.name.text == "private" } }

    let params: [ParamInfo]
    if let explicitInit {
      params = explicitInit.signature.parameterClause.parameters.map(paramInfo(from:))
    } else {
      params = memberwiseParams(of: node)
    }

    let environment = Self.environmentRequirements(of: node)
    if !environment.isEmpty { out.environmentRequires[node.name.text] = environment }

    out.views.append(ViewDecl(
      name: node.name.text,
      file: file,
      line: line(node),
      params: params,
      hasExplicitInit: explicitInit != nil
    ))
    return .visitChildren
  }

  /// What this view reads out of the environment, named the way the runtime audit can check.
  ///
  /// This matters because the two failure modes are not alike. A missing `@EnvironmentObject`
  /// traps, loudly, and the capture obviously failed. A missing `@Environment` key does not: SwiftUI
  /// hands back `defaultValue` and the screen renders a complete, plausible, wrong result that no
  /// screenshot comparison can catch. The harness can only report that if it is told, statically,
  /// what the screen expected — so this is the data behind `ScreenRegistry.requirements`.
  ///
  /// What it reports is a *declaration*, which is the only thing a syntax pass can observe:
  ///
  ///   `@EnvironmentObject var session: AppSession`   -> "AppSession"   (the type)
  ///   `@Environment(\.themeAccent) var accent`       -> "themeAccent"  (the key path member)
  ///   `@Environment(Model.self) var model`           -> "Model"        (the observable type)
  ///
  /// Limitation worth stating rather than discovering: only the view's *own* properties are seen.
  /// A screen whose body contains a child that reads the environment requires that key just as
  /// much, and nothing here says so. Closing that needs the body's view graph, not its members.
  private static func environmentRequirements(of node: StructDeclSyntax) -> [String] {
    var found: [String] = []
    for member in node.memberBlock.members {
      guard let variable = member.decl.as(VariableDeclSyntax.self) else { continue }
      if variable.modifiers.contains(where: { $0.name.text == "static" }) { continue }
      for attribute in variable.attributes {
        guard let attribute = attribute.as(AttributeSyntax.self) else { continue }
        let name = attribute.attributeName.trimmedDescription
        if name == "EnvironmentObject" {
          // The requirement is the declared type; there is no argument to read.
          for binding in variable.bindings {
            guard let type = binding.typeAnnotation?.type.trimmedDescription else { continue }
            if !found.contains(type) { found.append(type) }
          }
          continue
        }
        guard name == "Environment",
              let argument = attribute.arguments?.as(LabeledExprListSyntax.self)?.first?.expression
        else { continue }
        // `\.themeAccent` — the member is the key, and `\.self` is a dump of the whole
        // environment rather than a requirement, so it is deliberately not one.
        if let keyPath = argument.as(KeyPathExprSyntax.self) {
          guard let component = keyPath.components.last,
                let property = component.component.as(KeyPathPropertyComponentSyntax.self)
          else { continue }
          let key = property.declName.baseName.text
          if key != "self", !found.contains(key) { found.append(key) }
          continue
        }
        // `Model.self` — an observable the app installs by type.
        if let member = argument.as(MemberAccessExprSyntax.self),
           member.declName.baseName.text == "self",
           let base = member.base?.trimmedDescription,
           !found.contains(base) {
          found.append(base)
        }
      }
    }
    return found
  }

  override func visit(_ node: EnumDeclSyntax) -> SyntaxVisitorContinueKind {
    if conforms(node.inheritanceClause, to: "Hashable")
      || conforms(node.inheritanceClause, to: "Identifiable") {
      out.hashableEnums.insert(node.name.text)
    }
    var cases: [String: [String]] = [:]
    for member in node.memberBlock.members {
      guard let decl = member.decl.as(EnumCaseDeclSyntax.self) else { continue }
      for element in decl.elements {
        cases[element.name.text] = element.parameterClause?.parameters
          .map { $0.type.trimmedDescription } ?? []
      }
    }
    if !cases.isEmpty { out.enumCases[node.name.text] = cases }
    return .visitChildren
  }

  private func conforms(_ clause: InheritanceClauseSyntax?, to name: String) -> Bool {
    clause?.inheritedTypes.contains { $0.type.trimmedDescription == name } ?? false
  }

  private func paramInfo(from p: FunctionParameterSyntax) -> ParamInfo {
    let type = p.type.trimmedDescription
    return ParamInfo(
      label: p.firstName.text,
      type: type,
      hasDefault: p.defaultValue != nil,
      isBinding: type.hasPrefix("Binding<"),
      isClosure: type.contains("->")
    )
  }

  /// Swift synthesizes a memberwise init when none is written; reconstruct its shape.
  private func memberwiseParams(of node: StructDeclSyntax) -> [ParamInfo] {
    var params: [ParamInfo] = []
    for member in node.memberBlock.members {
      guard let v = member.decl.as(VariableDeclSyntax.self) else { continue }
      if v.modifiers.contains(where: { $0.name.text == "static" }) { continue }

      let wrappers = v.attributes.compactMap {
        $0.as(AttributeSyntax.self)?.attributeName.trimmedDescription
      }
      if wrappers.contains(where: { runtimeResolvedWrappers.contains($0) }) { continue }
      let isBinding = wrappers.contains("Binding")

      for binding in v.bindings {
        // Computed properties (incl. `body`) are not stored.
        if binding.accessorBlock != nil { continue }
        let name = binding.pattern.trimmedDescription
        let type = binding.typeAnnotation?.type.trimmedDescription ?? "_"
        params.append(ParamInfo(
          label: name,
          type: type,
          hasDefault: binding.initializer != nil,
          isBinding: isBinding || type.hasPrefix("Binding<"),
          isClosure: type.contains("->")
        ))
      }
    }
    return params
  }

  // MARK: - Call sites

  private static func calleeName(_ node: FunctionCallExprSyntax) -> String? {
    if let decl = node.calledExpression.as(DeclReferenceExprSyntax.self) {
      return decl.baseName.text
    }
    if let member = node.calledExpression.as(MemberAccessExprSyntax.self) {
      return member.declName.baseName.text
    }
    return nil
  }

  override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
    guard let name = Self.calleeName(node) else { return .visitChildren }
    switch name {
    case "NavigationLink":
      recordNavigationLink(node)
    case "navigationDestination":
      recordNavigationDestination(node)
    case "sheet", "fullScreenCover", "popover":
      recordPresentation(node)
    case "navigationTitle", "navigationBarTitle":
      if let owner = enclosingTypeName(of: node) { out.markScreen(owner, .navigationTitle) }
    case "TabView", "NavigationSplitView", "NavigationStack", "NavigationView":
      recordNavigator(node, named: name)
    case _ where sceneContainers.contains(name):
      recordSceneEntry(node)
    default:
      // A bare `SomeView(...)` construction.
      if node.calledExpression.is(DeclReferenceExprSyntax.self), name.first?.isUppercase == true {
        record(node, name: name, context: previewDepth > 0 ? .preview : .other)
        recordChild(name, at: node)
      }
    }
    return .visitChildren
  }

  /// `from -> to` as plain containment, which is what the environment travels down.
  ///
  /// Deliberately separate from `viewEdges`: that records navigation a user can trace, while this
  /// records every view a body builds, navigation or not. A child a screen merely embeds still
  /// reads the same environment the screen was presented in.
  private func recordChild(_ child: String, at node: FunctionCallExprSyntax) {
    guard previewDepth == 0, let owner = enclosingTypeName(of: node), owner != child else { return }
    if out.childrenByView[owner, default: []].contains(child) { return }
    out.childrenByView[owner, default: []].append(child)
  }

  /// What a scene container presents: `WindowGroup { RootView() }` presents `RootView`.
  ///
  /// This is where a journey starts, and it is read from the scene rather than from everything the
  /// `App` type's members and extensions happen to construct. The difference is not academic: an
  /// app with a debug overlay writes `AppView(...).overlay { CaptureLayer() }` in that same scene
  /// body, and the wider reading named the overlay as a second place a journey starts. Only the
  /// first non-container construction inside the scene's own content counts.
  private func recordSceneEntry(_ node: FunctionCallExprSyntax) {
    guard previewDepth == 0, let owner = enclosingTypeName(of: node) else { return }
    let content: Syntax? =
      node.trailingClosure.map { Syntax($0) }
      ?? node.arguments.first { $0.label?.text == "content" }.map { Syntax($0.expression) }
    guard let content, let (presented, _) = firstPresented(in: content) else { return }
    if out.sceneEntries[owner, default: []].contains(presented) { return }
    out.sceneEntries[owner, default: []].append(presented)
  }

  private func recordNavigator(_ node: FunctionCallExprSyntax, named name: String) {
    guard previewDepth == 0, let owner = enclosingTypeName(of: node) else { return }
    let kind: NavigatorKind
    switch name {
    case "TabView": kind = .tabs
    case "NavigationSplitView": kind = .splitView
    default: kind = .stack
    }
    out.navigators.append(NavigatorDecl(
      view: owner, kind: kind, via: name, file: file, line: line(node)
    ))
  }

  private func record(
    _ node: FunctionCallExprSyntax,
    name: String,
    context: CallContext,
    patternBound: [String] = [],
    routeType: String? = nil,
    caseName: String? = nil
  ) {
    var free: Set<String> = []
    collectFreeIdentifiers(Syntax(node), bound: [], into: &free)
    let boundSet = Set(patternBound)
    out.callSites.append(CallSite(
      viewName: name,
      expression: node.trimmedDescription,
      context: context,
      unresolvedNames: free.subtracting(boundSet).sorted(),
      patternBoundNames: patternBound.filter { free.contains($0) },
      routeType: routeType,
      caseName: caseName,
      file: file,
      line: line(node)
    ))
  }

  private func recordNavigationLink(_ node: FunctionCallExprSyntax) {
    let valueArgument = node.arguments.first { $0.label?.text == "value" }
    let hasValue = valueArgument != nil
    if let valueArgument {
      out.navLinkValueCount += 1
      recordRouteValue(valueArgument.expression, at: node)
    }

    let destination: Syntax? =
      node.arguments.first { $0.label?.text == "destination" }.map { Syntax($0.expression) }
      ?? node.additionalTrailingClosures
        .first { $0.label.text == "destination" }
        .map { Syntax($0.closure) }
      ?? (hasValue ? nil : node.trailingClosure.map { Syntax($0) })

    guard let destination else { return }
    out.navLinkDestinationCount += 1
    if let (name, call) = firstPresented(in: destination) {
      out.markScreen(name, .navigationLink)
      record(call, name: name, context: previewDepth > 0 ? .preview : .navigationLink)
      recordViewEdge(to: name, kind: .push, via: "NavigationLink", at: node)
    }
  }

  /// Harvests `NavigationLink(value: Route.orderDetail("A-1042"))` — a real route value, written
  /// down by the app, for a case whose destination arm only ever binds it as a pattern name.
  ///
  /// Two shapes qualify: a call on a member access (`Route.orderDetail(…)` / `.orderDetail(…)`) and
  /// a bare member access for a case with no associated values (`Route.settings` / `.settings`). A
  /// value built from anything that would not resolve at the lift site — a local, an instance
  /// property, a `$projection` — is dropped whole rather than recorded in part: half an argument
  /// list is not an observation, and the existing free-identifier rule is exactly the test for it.
  private func recordRouteValue(_ expression: ExprSyntax, at node: FunctionCallExprSyntax) {
    guard previewDepth == 0 else { return }

    func routeCase(_ member: MemberAccessExprSyntax) -> (String?, String)? {
      let caseName = member.declName.baseName.text
      guard caseName.first?.isLowercase == true else { return nil }
      guard let base = member.base else { return (nil, caseName) }
      guard let reference = base.as(DeclReferenceExprSyntax.self),
            reference.baseName.text.first?.isUppercase == true else { return nil }
      return (reference.baseName.text, caseName)
    }

    if let member = expression.as(MemberAccessExprSyntax.self) {
      guard let (routeType, caseName) = routeCase(member) else { return }
      out.observedRouteValues.append(RouteValueObservation(
        routeType: routeType, caseName: caseName, arguments: [], file: file, line: line(node)
      ))
      return
    }

    guard let call = expression.as(FunctionCallExprSyntax.self),
          let member = call.calledExpression.as(MemberAccessExprSyntax.self),
          let (routeType, caseName) = routeCase(member)
    else { return }

    var arguments: [String] = []
    for argument in call.arguments {
      var free: Set<String> = []
      collectFreeIdentifiers(Syntax(argument.expression), bound: [], into: &free)
      guard free.isEmpty else { return }
      arguments.append(argument.expression.trimmedDescription)
    }
    out.observedRouteValues.append(RouteValueObservation(
      routeType: routeType, caseName: caseName, arguments: arguments, file: file, line: line(node)
    ))
  }

  private func recordPresentation(_ node: FunctionCallExprSyntax) {
    let content: Syntax? =
      node.trailingClosure.map { Syntax($0) }
      ?? node.arguments.first { $0.label?.text == "content" }.map { Syntax($0.expression) }
    guard let content else { return }
    if let (name, call) = firstPresented(in: content) {
      out.markScreen(name, .sheet)
      record(call, name: name, context: previewDepth > 0 ? .preview : .other)
      recordViewEdge(to: name, kind: .modal, via: Self.calleeName(node) ?? "sheet", at: node)
    }
  }

  /// `.navigationDestination(for: Route.self) { switch $0 { case .a(let x): AView(x) ... } }`
  /// is the whole navigation graph written out in source — harvest every arm.
  private func recordNavigationDestination(_ node: FunctionCallExprSyntax) {
    var routeType: String?
    if let forArg = node.arguments.first(where: { $0.label?.text == "for" }) {
      let text = forArg.expression.trimmedDescription
      routeType = text.hasSuffix(".self") ? String(text.dropLast(5)) : text
    } else if let itemArg = node.arguments.first(where: { $0.label?.text == "item" }) {
      // `.navigationDestination(item: $startingPoint) { target in switch target { ... } }`
      // carries no `Type.self`, so recover it from the bound property's own declaration.
      routeType = itemBindingType(itemArg.expression)
    } else if node.arguments.contains(where: { $0.label?.text == "isPresented" }) {
      // A bare boolean presentation — a destination, but not a typed route.
      routeType = nil
    }
    if let routeType { out.navigationDestinationTypes.insert(routeType) }
    guard let body = node.trailingClosure else { return }

    guard let switchExpr = firstSwitch(in: Syntax(body)) else {
      // No switch — a single destination for the whole route type.
      if let (name, call) = firstPresented(in: Syntax(body)) {
        out.markScreen(name, .navigationDestination)
        record(call, name: name, context: .navigationDestination)
        recordViewEdge(to: name, kind: .route, via: "navigationDestination", at: node)
      }
      return
    }

    for caseSyntax in switchExpr.cases {
      guard let switchCase = caseSyntax.as(SwitchCaseSyntax.self),
            let label = switchCase.label.as(SwitchCaseLabelSyntax.self),
            let pattern = label.caseItems.first?.pattern else { continue }
      let caseName = caseIdentifier(pattern.trimmedDescription)
      guard let (name, call) = firstPresented(in: Syntax(switchCase.statements))
      else { continue }
      out.markScreen(name, .navigationDestination)
      record(
        call, name: name, context: .navigationDestination,
        patternBound: patternBoundNames(pattern),
        routeType: routeType, caseName: caseName
      )
      recordViewEdge(to: name, kind: .route, via: "navigationDestination", at: node)
      out.routeEdges.append(RouteEdge(
        routeType: routeType ?? "?",
        caseName: caseName,
        associatedTypes: [],   // filled in from the enum declaration after the walk
        destinationView: name,
        expression: call.trimmedDescription,
        file: file,
        line: line(call)
      ))
    }
  }

  /// `navigationDestination(item:)` takes a `Binding<Item?>` rather than a `Type.self`,
  /// so the route type is only recoverable from the declaration the binding projects:
  /// `$startingPoint` -> `@State private var startingPoint: SettingsStartingPoint?`.
  /// Nothing is guessed — if the declaration is not in this file with a written type
  /// annotation, the destinations are still recorded, just without a route type.
  private func itemBindingType(_ expr: ExprSyntax) -> String? {
    var name: String?
    if let ref = expr.as(DeclReferenceExprSyntax.self), ref.baseName.text.hasPrefix("$") {
      name = String(ref.baseName.text.dropFirst())
    } else if let member = expr.as(MemberAccessExprSyntax.self) {
      // `$store.destination` and friends: the member is the property we want.
      name = member.declName.baseName.text
    }
    guard let name else { return nil }

    var scope = Syntax(expr).parent
    while let current = scope {
      let members: MemberBlockItemListSyntax?
      if let s = current.as(StructDeclSyntax.self) { members = s.memberBlock.members }
      else if let c = current.as(ClassDeclSyntax.self) { members = c.memberBlock.members }
      else if let e = current.as(ExtensionDeclSyntax.self) { members = e.memberBlock.members }
      else { members = nil }

      if let members {
        for member in members {
          guard let variable = member.decl.as(VariableDeclSyntax.self) else { continue }
          for binding in variable.bindings
          where binding.pattern.trimmedDescription == name {
            guard let annotated = binding.typeAnnotation?.type.trimmedDescription
            else { continue }
            let bare = annotated.hasSuffix("?") ? String(annotated.dropLast()) : annotated
            return bare.hasPrefix("Optional<") && bare.hasSuffix(">")
              ? String(bare.dropFirst(9).dropLast())
              : bare
          }
        }
      }
      scope = current.parent
    }
    return nil
  }

  /// `.accountDetail(let id)` -> `accountDetail`
  private func caseIdentifier(_ text: String) -> String {
    let trimmed = text.hasPrefix(".") ? String(text.dropFirst()) : text
    return String(trimmed.prefix { $0.isLetter || $0.isNumber || $0 == "_" })
  }

  private func firstSwitch(in root: Syntax) -> SwitchExprSyntax? {
    if let s = root.as(SwitchExprSyntax.self) { return s }
    for child in root.children(viewMode: .sourceAccurate) {
      if let found = firstSwitch(in: child) { return found }
    }
    return nil
  }

  /// Every `SomeView(...)` beneath `root`, in source order.
  private func allConstructions(in root: Syntax) -> [(String, FunctionCallExprSyntax)] {
    var found: [(String, FunctionCallExprSyntax)] = []
    if let call = root.as(FunctionCallExprSyntax.self),
       let callee = call.calledExpression.as(DeclReferenceExprSyntax.self),
       callee.baseName.text.first?.isUppercase == true,
       callee.baseName.text != "NavigationLink" {
      found.append((callee.baseName.text, call))
    }
    for child in root.children(viewMode: .sourceAccurate) {
      found.append(contentsOf: allConstructions(in: child))
    }
    return found
  }

  // MARK: - Liftability

  /// Can this construction expression be re-written verbatim somewhere else and still
  /// compile? It can exactly when every *free* identifier it references resolves at the
  /// lift site. Resolvable, in source terms:
  ///
  ///   * literals of any kind (they contribute no identifiers at all);
  ///   * base-less member access — `.constant(...)`, `.trending`, `.hashtag(tag:)` —
  ///     which the compiler resolves against the parameter's own type;
  ///   * an upper-case-initial base, i.e. a type reference: `TimelineFilter.trending`,
  ///     `Theme.shared`, `TimelineView(...)`. Same-module visibility is the same
  ///     assumption the `preview` rung already makes when it lifts verbatim;
  ///   * names bound *inside* the expression (closure parameters, `$0`).
  ///
  /// Everything else — a lower-case-initial bare reference, or any `$projection` —
  /// is a local or an instance property and is reported, never guessed at.
  private func collectFreeIdentifiers(
    _ node: Syntax,
    bound: Set<String>,
    into found: inout Set<String>
  ) {
    if let member = node.as(MemberAccessExprSyntax.self) {
      // Skip `declName`: the member itself is resolved against the base's type.
      guard let base = member.base else { return }
      if let ref = base.as(DeclReferenceExprSyntax.self),
         ref.baseName.text.first?.isUppercase == true {
        return  // `SomeType.member` — a type reference.
      }
      collectFreeIdentifiers(Syntax(base), bound: bound, into: &found)
      return
    }

    if let ref = node.as(DeclReferenceExprSyntax.self) {
      let name = ref.baseName.text
      if bound.contains(name) { return }
      if name.first?.isUppercase == true { return }  // type reference
      // `self` deliberately counts as unresolved: at the lift site there is no instance,
      // so `self.appDelegate.store` is exactly as unavailable as a bare local.
      found.insert(name)
      return
    }

    if let closure = node.as(ClosureExprSyntax.self) {
      var inner = bound
      // Shorthand `$0`-style parameters are always in scope inside a closure.
      for index in 0..<10 { inner.insert("$\(index)") }
      if let signature = closure.signature {
        switch signature.parameterClause {
        case .simpleInput(let list):
          for parameter in list { inner.insert(parameter.name.text) }
        case .parameterClause(let clause):
          for parameter in clause.parameters {
            inner.insert(parameter.secondName?.text ?? parameter.firstName.text)
          }
        case nil:
          break
        }
      }
      // `{ var apiClient = ApiClient.noop; apiClient.override(...) }` is self-contained:
      // the local is declared and used inside the very expression being lifted, so it
      // is not a dependency on the original site. Collecting the whole closure's
      // bindings up front over-approximates their scope slightly (a name is treated as
      // bound above its own declaration too), which can only ever hide a name that
      // would not have compiled at the original site either.
      for statement in closure.statements {
        guard let variable = statement.item.as(VariableDeclSyntax.self) else { continue }
        for binding in variable.bindings {
          collectPatternNames(Syntax(binding.pattern), into: &inner)
        }
      }
      for child in closure.children(viewMode: .sourceAccurate) {
        collectFreeIdentifiers(child, bound: inner, into: &found)
      }
      return
    }

    for child in node.children(viewMode: .sourceAccurate) {
      collectFreeIdentifiers(child, bound: bound, into: &found)
    }
  }

  /// Every identifier a binding pattern introduces, e.g. `(a, b)` -> `a`, `b`.
  private func collectPatternNames(_ node: Syntax, into names: inout Set<String>) {
    if let identifier = node.as(IdentifierPatternSyntax.self) {
      names.insert(identifier.identifier.text)
      return
    }
    for child in node.children(viewMode: .sourceAccurate) {
      collectPatternNames(child, into: &names)
    }
  }

  /// Names a `switch` case pattern binds, in source order:
  /// `case .hashTag(let tag, let accountId)` -> `["tag", "accountId"]`.
  private func patternBoundNames(_ pattern: PatternSyntax) -> [String] {
    var names: [String] = []
    func walk(_ node: Syntax, insideLet: Bool) {
      if let identifier = node.as(IdentifierPatternSyntax.self) {
        names.append(identifier.identifier.text)
        return
      }
      let isLet = insideLet || node.is(ValueBindingPatternSyntax.self)
      // `case let .foo(a, b)` parses the bindings as plain expressions.
      if isLet, let ref = node.as(DeclReferenceExprSyntax.self) {
        if ref.baseName.text.first?.isUppercase != true { names.append(ref.baseName.text) }
        return
      }
      for child in node.children(viewMode: .sourceAccurate) { walk(child, insideLet: isLet) }
    }
    walk(Syntax(pattern), insideLet: false)
    return names
  }
}
