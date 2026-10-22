import SwiftUI
import UIKit
import os

let appflowLog = Logger(subsystem: "dev.codex.appflow.present", category: "harness")

// MARK: - Binding host
//
// A `@Binding` parameter cannot be satisfied by a lifted construction
// expression: `CounterEditorView(count: $count)` has no `count` to bind to
// outside its original call site. The registry therefore wraps such screens in
// a host that owns the storage and hands the screen a real binding.
struct BindingHost<Value, Content: View>: View {
  @State private var value: Value
  private let content: (Binding<Value>) -> Content

  init(initial: Value, @ViewBuilder content: @escaping (Binding<Value>) -> Content) {
    _value = State(initialValue: initial)
    self.content = content
  }

  var body: some View { content($value) }
}

// MARK: - Readiness signals

enum ReadinessSignal: String, CaseIterable {
  /// First committed frame. The current baseline; included so the comparison
  /// is honest rather than flattering.
  case frame
  /// Consecutive downscaled rasters stop differing for a quiet window.
  case stable
  /// No tracked in-flight work and no layer animation, for a quiet window.
  case idle
  /// Backstop: fire at the budget regardless.
  case timeout
}

struct SignalLog {
  var frameMs: Double?
  var stableMs: Double?
  var idleMs: Double?
  var timeoutMs: Double?
  /// Diagnostics for the stability signal.
  var stableSamples: Int = 0
  var lastDiff: Double = -1
  /// Diagnostics for the idle signal.
  var sawAnimation: Bool = false
  var peakOutstanding: Int = 0

  func time(of s: ReadinessSignal) -> Double? {
    switch s {
    case .frame: return frameMs
    case .stable: return stableMs
    case .idle: return idleMs
    case .timeout: return timeoutMs
    }
  }

  var json: String {
    func v(_ d: Double?) -> String { d.map { String(format: "%.1f", $0) } ?? "null" }
    return """
    {"frame_ms":\(v(frameMs)),"stable_ms":\(v(stableMs)),\
    "idle_ms":\(v(idleMs)),"timeout_ms":\(v(timeoutMs)),"stable_samples":\(stableSamples),\
    "last_diff":\(String(format: "%.5f", lastDiff)),"saw_animation":\(sawAnimation),\
    "peak_outstanding":\(peakOutstanding)}
    """
  }
}

/// Tunables for the two inferred signals. Exposed on the control channel so the
/// thresholds can be swept from the host instead of guessed in source.
struct ReadinessTuning {
  /// Sampling interval for the stability raster, milliseconds.
  var sampleMs: Double = 50
  /// Mean per-channel difference (0...1) below which two rasters count as equal.
  var stableThreshold: Double = 0.004
  /// How long rasters must stay equal before `stable` fires, milliseconds.
  var stableQuietMs: Double = 250
  /// How long the work ledger must stay empty before `idle` fires, milliseconds.
  var idleQuietMs: Double = 150
  /// Backstop.
  var budgetMs: Double = 5000
  /// Comparison raster size. Coarse hides a spinner; fine exposes text
  /// antialiasing and a blinking caret. There may be no setting that does
  /// neither -- that is the question the sweep answers.
  var thumbW: Int = 48
  var thumbH: Int = 104
}

// MARK: - Raster sampling

enum SnapshotKind: String {
  /// `CALayer.render(in:)` over the key window.
  case layer
  /// `UIView.drawHierarchy(afterScreenUpdates: true)` over the key window.
  case draw
  /// SwiftUI `ImageRenderer` over a freshly built copy of the screen.
  case renderer
}

@MainActor
enum Raster {
  static var keyWindow: UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow } ??
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }.first
  }

  /// Set by the app root: re-applies the app-root environment to a view the
  /// harness builds outside the live tree (needed only by `.renderer`).
  static var applyRootEnvironment: ((AnyView) -> AnyView)?

  static func image(kind: SnapshotKind, scale: CGFloat = 0, screen: String? = nil,
                    nav: Bool = true) -> UIImage? {
    switch kind {
    case .layer, .draw:
      guard let w = keyWindow else { return nil }
      let fmt = UIGraphicsImageRendererFormat.default()
      if scale > 0 { fmt.scale = scale }
      fmt.opaque = true
      let r = UIGraphicsImageRenderer(bounds: w.bounds, format: fmt)
      return r.image { ctx in
        if kind == .layer {
          w.layer.render(in: ctx.cgContext)
        } else {
          w.drawHierarchy(in: w.bounds, afterScreenUpdates: true)
        }
      }
    case .renderer:
      guard let name = screen, let make = ScreenRegistry.entries[name],
            let w = keyWindow else { return nil }
      var content = nav ? AnyView(NavigationStack { make() }) : AnyView(make())
      if let apply = applyRootEnvironment { content = apply(content) }
      let ir = ImageRenderer(content: content.frame(width: w.bounds.width, height: w.bounds.height))
      ir.scale = scale > 0 ? scale : w.traitCollection.displayScale
      return ir.uiImage
    }
  }

  /// A tiny grayscale thumbnail used only for frame-to-frame comparison.
  /// 48x104 is small enough that sampling at 50 ms costs little, and coarse
  /// enough that sub-pixel text antialiasing jitter does not read as change.
  static func thumbnail(_ w: UIWindow, _ tw: Int = 48, _ th: Int = 104) -> [UInt8]? {
    var buf = [UInt8](repeating: 0, count: tw * th)
    guard let cs = CGColorSpace(name: CGColorSpace.linearGray),
          let ctx = CGContext(data: &buf, width: tw, height: th, bitsPerComponent: 8,
                              bytesPerRow: tw, space: cs,
                              bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { return nil }
    ctx.translateBy(x: 0, y: CGFloat(th))
    ctx.scaleBy(x: CGFloat(tw) / w.bounds.width, y: -CGFloat(th) / w.bounds.height)
    w.layer.render(in: ctx)
    return buf
  }

  static func meanDiff(_ a: [UInt8], _ b: [UInt8]) -> Double {
    guard a.count == b.count, !a.isEmpty else { return 1 }
    var total = 0
    for i in 0..<a.count { total += abs(Int(a[i]) - Int(b[i])) }
    return Double(total) / Double(a.count) / 255.0
  }
}

// MARK: - Environment satisfaction check
//
// A missing `@EnvironmentObject` traps loudly. A missing `@Environment` key
// does not: SwiftUI hands back `defaultValue` and the screen renders a
// plausible lie. Nothing in SwiftUI reports which keys a view *read*, but
// `@Environment(\.self)`'s description does enumerate which keys are
// *installed* at a given point in the tree. Pair that with what the registry
// statically says each screen requires and the pipeline can tell.
//
// `String(describing: EnvironmentValues)` is undocumented SPI-shaped output.
// See the report for the durability caveat.

@MainActor
enum EnvironmentAudit {
  /// Raw dump captured at the presentation site for the current generation.
  static var dump: String = ""
  static var dumpGeneration: Int = -1

  private static func normalize(_ s: String) -> String {
    s.lowercased().filter { $0.isLetter || $0.isNumber }
  }

  /// Key names the dump says are installed where the screen was presented.
  static var installedKeys: [String] {
    var out: [String] = []
    var rest = Substring(dump)
    let marker = "EnvironmentPropertyKey<"
    while let r = rest.range(of: marker) {
      rest = rest[r.upperBound...]
      // Balanced scan to the matching '>' so nested generics survive.
      var depth = 1
      var name = ""
      for ch in rest {
        if ch == "<" { depth += 1 }
        if ch == ">" { depth -= 1; if depth == 0 { break } }
        name.append(ch)
      }
      out.append(name)
    }
    return out
  }

  /// `nil` when the registry records no requirement for the screen.
  static func verdict(for screen: String) -> (satisfied: [String], missing: [String])? {
    guard let required = ScreenRegistry.requirements[screen], !required.isEmpty else {
      return ([], [])
    }
    let installed = installedKeys.map(normalize)
    var sat: [String] = []
    var miss: [String] = []
    for req in required {
      let n = normalize(req)
      if installed.contains(where: { $0.contains(n) }) { sat.append(req) } else { miss.append(req) }
    }
    return (sat, miss)
  }
}

struct EnvAuditProbe: View {
  let generation: Int
  @Environment(\.self) private var env
  var body: some View {
    Color.clear.frame(width: 0, height: 0)
      .onAppear {
        EnvironmentAudit.dump = String(describing: env)
        EnvironmentAudit.dumpGeneration = generation
      }
  }
}

// MARK: - Presentation controller

enum PresentationMode: String {
  /// Overlaid inside the live root view tree (inherits the root environment).
  case overlay
  /// Hosted in a brand-new UIWindow (no app-root environment at all).
  case bare
}

struct PresentOptions {
  var mode: PresentationMode = .overlay
  /// Wrap the screen in a NavigationStack at the presentation site so
  /// `.navigationTitle` has a bar to render into.
  var nav: Bool = true
  var waitFor: ReadinessSignal = .idle
  var tuning = ReadinessTuning()
  /// Keep sampling past `waitFor` so one presentation times every signal.
  var observeAll: Bool = false
}

@MainActor
final class PresentationController: ObservableObject {
  static let shared = PresentationController()

  @Published var screen: String?
  @Published var generation: Int = 0
  @Published var navWrapped: Bool = true

  /// Wall-clock marker set the instant the present request is accepted.
  private(set) var requestedAt: CFAbsoluteTime = 0
  @Published private(set) var log = SignalLog()
  private(set) var options = PresentOptions()

  private var completion: ((SignalLog) -> Void)?
  private var completed = false
  private var ticker: Timer?
  private var lastThumb: [UInt8]?
  private var quietSince: CFAbsoluteTime?
  private var workEmptySince: CFAbsoluteTime?
  private var frameCommitted = false

  private var bareWindow: UIWindow?

  // MARK: Present / dismiss

  func present(_ name: String, options opts: PresentOptions,
               completion: ((SignalLog) -> Void)? = nil) {
    stopTicker()
    self.options = opts
    self.completion = completion
    completed = false
    log = SignalLog()
    lastThumb = nil
    quietSince = nil
    workEmptySince = nil
    frameCommitted = false
    // The ledger is the harness's own bookkeeping, not app state: a stale entry from a
    // previous presentation would hold `idle` off forever. App state is reset by
    // relaunching the process, which is the only reset that cannot miss anything.
    WorkTracker.shared.reset()
    navWrapped = opts.nav
    requestedAt = CFAbsoluteTimeGetCurrent()
    switch opts.mode {
    case .overlay:
      generation += 1
      screen = name
      appflowLog.notice("present overlay \(name, privacy: .public) gen=\(self.generation) wait=\(opts.waitFor.rawValue, privacy: .public)")
    case .bare:
      presentBare(name)
    }
    startTicker()
  }

  func dismiss() {
    stopTicker()
    screen = nil
    log = SignalLog()
    bareWindow?.isHidden = true
    bareWindow = nil
    completion = nil
    completed = true
    appflowLog.notice("dismiss")
  }

  /// Called by the overlay's `onAppear`: the screen's first frame is about to
  /// be committed. One run-loop hop later it actually has been.
  func markAppear() {
    let appear = (CFAbsoluteTimeGetCurrent() - requestedAt) * 1000
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.frameCommitted = true
      self.log.frameMs = (CFAbsoluteTimeGetCurrent() - self.requestedAt) * 1000
      appflowLog.notice("signal frame=\(self.log.frameMs ?? -1)ms (appear \(appear)ms)")
      self.maybeFinish()
    }
  }

  // MARK: Inferred signals

  private func startTicker() {
    let t = Timer.scheduledTimer(withTimeInterval: options.tuning.sampleMs / 1000,
                                 repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    RunLoop.main.add(t, forMode: .common)
    ticker = t
  }

  private func stopTicker() { ticker?.invalidate(); ticker = nil }

  private func tick() {
    let now = CFAbsoluteTimeGetCurrent()
    let elapsed = (now - requestedAt) * 1000
    let tune = options.tuning

    // --- stable: consecutive rasters stop differing
    if log.stableMs == nil, let w = Raster.keyWindow,
       let thumb = Raster.thumbnail(w, tune.thumbW, tune.thumbH) {
      if let prev = lastThumb {
        let d = Raster.meanDiff(prev, thumb)
        log.lastDiff = d
        if d <= tune.stableThreshold {
          if quietSince == nil { quietSince = now }
          log.stableSamples += 1
          if (now - (quietSince ?? now)) * 1000 >= tune.stableQuietMs {
            log.stableMs = elapsed
            appflowLog.notice("signal stable=\(elapsed)ms diff=\(d)")
          }
        } else {
          quietSince = nil
          log.stableSamples = 0
        }
      }
      lastThumb = thumb
    }

    // --- idle: nothing tracked in flight, nothing animating
    let outstanding = WorkTracker.shared.total
    log.peakOutstanding = max(log.peakOutstanding, outstanding)
    let animating = Self.hasRunningAnimation()
    if animating { log.sawAnimation = true }
    if log.idleMs == nil {
      if frameCommitted && outstanding == 0 && !animating {
        if workEmptySince == nil { workEmptySince = now }
        if (now - (workEmptySince ?? now)) * 1000 >= tune.idleQuietMs {
          log.idleMs = elapsed
          appflowLog.notice("signal idle=\(elapsed)ms")
        }
      } else {
        workEmptySince = nil
      }
    }

    // --- timeout backstop
    if elapsed >= tune.budgetMs, log.timeoutMs == nil {
      log.timeoutMs = elapsed
      appflowLog.notice("signal timeout=\(elapsed)ms")
    }

    maybeFinish()
  }

  /// Does any layer under the key window have a CAAnimation attached?
  private static func hasRunningAnimation() -> Bool {
    guard let w = Raster.keyWindow else { return false }
    var stack: [CALayer] = [w.layer]
    var budget = 4000
    while let l = stack.popLast(), budget > 0 {
      budget -= 1
      if let keys = l.animationKeys(), !keys.isEmpty { return true }
      stack.append(contentsOf: l.sublayers ?? [])
    }
    return false
  }

  private func maybeFinish() {
    guard !completed, let cb = completion else { return }
    let haveAll = ReadinessSignal.allCases.allSatisfy { log.time(of: $0) != nil }
    let reached = log.time(of: options.waitFor) != nil
    let expired = log.timeoutMs != nil
    if options.observeAll {
      guard haveAll || expired else { return }
    } else {
      guard reached || expired else { return }
    }
    completed = true
    completion = nil
    stopTicker()
    cb(log)
  }

  // MARK: Bare presentation (the known-hostile control)

  /// Deliberately hostile presentation: the registry's view, alone, in a fresh
  /// window, with none of the app-root environment attached.
  private func presentBare(_ name: String) {
    guard let scene = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene }).first,
      let make = ScreenRegistry.entries[name]
    else {
      appflowLog.error("bare present failed to resolve \(name, privacy: .public)")
      return
    }
    appflowLog.notice("present bare \(name, privacy: .public) (no environment)")
    // The audit probe goes in here too, at the same environment depth as the
    // screen, so the unsatisfied case is actually reported rather than just
    // rendering wrong in silence.
    let gen = generation
    let host = UIHostingController(rootView: AnyView(
      ZStack {
        NavigationStack { make() }
        EnvAuditProbe(generation: gen)
      }
    ))
    let window = UIWindow(windowScene: scene)
    window.rootViewController = host
    window.windowLevel = .alert + 1
    window.makeKeyAndVisible()
    bareWindow = window
    markAppear()
  }
}

// MARK: - Capture overlay
//
// Presented *over the live root view*, inside the same view tree, so every
// `.environmentObject` / `.environment` the root installed is still in scope.
struct CaptureOverlay: View {
  @ObservedObject var controller: PresentationController
  /// Hidden during a snapshot comparison so the HUD is not part of the image.
  var showHUD: Bool = true

  var body: some View {
    if let name = controller.screen {
      ZStack(alignment: .top) {
        Color(white: 1.0).ignoresSafeArea()
        Group {
          if let make = ScreenRegistry.entries[name] {
            // A NavigationStack at the presentation site: without it
            // `.navigationTitle` has nowhere to render and silently vanishes.
            if controller.navWrapped {
              NavigationStack {
                make()
                  // Without an explicit toolbar background the iOS 26 glass bar
                  // renders its large title with a vibrancy blend that resolves
                  // to near-white over the capture backdrop: the title is drawn
                  // and invisible. Forcing the background restores contrast.
                  .toolbarBackground(.visible, for: .navigationBar)
              }
            } else {
              make()
            }
          } else {
            Text("No registry entry for \(name)").foregroundStyle(.red)
          }
        }
        .padding(.top, showHUD ? 22 : 0)
        if showHUD { hud(name: name) }
        EnvAuditProbe(generation: controller.generation)
      }
      // A fresh identity per generation: no view state survives a re-present.
      .id(controller.generation)
      .transition(.identity)
      .onAppear { controller.markAppear() }
    }
  }

  private func hud(name: String) -> some View {
    HStack(spacing: 6) {
      Text("CAPTURE").bold()
      Text(name)
      Spacer()
      Text(timing)
    }
    .font(.system(size: 10, weight: .semibold, design: .monospaced))
    .padding(.horizontal, 8).padding(.vertical, 3)
    .foregroundStyle(.white)
    .background(.black.opacity(0.78))
    .frame(maxWidth: .infinity)
  }

  private var timing: String {
    let l = controller.log
    func v(_ d: Double?) -> String { d.map { String(format: "%.0f", $0) } ?? "-" }
    return "f\(v(l.frameMs)) s\(v(l.stableMs)) i\(v(l.idleMs))"
  }
}

// MARK: - App entry

@main
struct DemoApp: App {
  @StateObject private var session = AppSession()
  @StateObject private var feed = FeedStore()
  @StateObject private var inbox = InboxStore()
  @StateObject private var staged = TwoStageOrderStore()
  @StateObject private var presentation = PresentationController.shared
  @StateObject private var hud = HUDVisibility.shared

  var body: some Scene {
    WindowGroup {
      ZStack {
        RootView()
        CaptureOverlay(controller: presentation, showHUD: hud.visible)
      }
      // The app-root environment every presented screen must still see.
      .environmentObject(session)
      .environmentObject(feed)
      .environmentObject(inbox)
      .environmentObject(staged)
      .environment(\.themeAccent, Color(red: 0.36, green: 0.20, blue: 0.86))
      .task { bootstrap() }
    }
  }

  private func bootstrap() {
    Raster.applyRootEnvironment = { view in
      AnyView(view
        .environmentObject(session)
        .environmentObject(feed)
        .environmentObject(inbox)
        .environmentObject(staged)
        .environment(\.themeAccent, Color(red: 0.36, green: 0.20, blue: 0.86)))
    }
    AppEnvironmentProbe.shared.read = {
      (session.tapCount, feed.posts.count, staged.stage, inbox.messages.count)
    }
    ControlServer.shared.start()
  }
}

/// The HUD is useful while driving the harness by hand and ruinous when the
/// screenshot is the artifact. Toggled from the control channel.
@MainActor
final class HUDVisibility: ObservableObject {
  static let shared = HUDVisibility()
  @Published var visible: Bool = true
}
