import Foundation
import Network
import UIKit

/// A debug-only HTTP control channel.
///
/// The obvious channel -- a custom URL scheme driven by `simctl openurl` -- is
/// unusable for capture on current iOS: LaunchServices puts an "Open in
/// <app>?" confirmation alert on screen, which is what ends up in the
/// screenshot. The simulator shares the host's network stack, so a listener
/// here is reachable from the Mac at 127.0.0.1 with no alert and no round trip
/// through LaunchServices.
///
/// It also lets the present request *block until a named readiness signal has
/// fired*, so the host learns the real timing instead of guessing a settle
/// delay -- and can return an in-app raster instead of paying for
/// `simctl io screenshot`.
final class ControlServer {
  static let shared = ControlServer()
  private var listener: NWListener?
  private let queue = DispatchQueue(label: "appflow.control")

  func start(port: UInt16 = 8765) {
    guard listener == nil else { return }
    do {
      let params = NWParameters.tcp
      params.allowLocalEndpointReuse = true
      let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
      l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
      l.start(queue: queue)
      listener = l
      appflowLog.notice("control server on \(port)")
    } catch {
      appflowLog.error("control server failed: \(error.localizedDescription, privacy: .public)")
    }
  }

  private func accept(_ conn: NWConnection) {
    conn.start(queue: queue)
    conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
      guard let self, let data, let text = String(data: data, encoding: .utf8),
            let line = text.split(separator: "\r\n").first,
            let path = line.split(separator: " ").dropFirst().first
      else { conn.cancel(); return }
      self.route(String(path)) { body, type in
        let head = "HTTP/1.1 200 OK\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        conn.send(content: Data(head.utf8) + body,
                  completion: .contentProcessed { _ in conn.cancel() })
      }
    }
  }

  private func route(_ path: String, reply raw: @escaping (Data, String) -> Void) {
    let json: (String) -> Void = { raw(Data($0.utf8), "application/json") }
    let comps = URLComponents(string: "http://localhost" + path)
    let q = Dictionary(uniqueKeysWithValues: (comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
    let route = comps?.path ?? ""
    DispatchQueue.main.async {
      let c = PresentationController.shared
      switch route {
      // The channel says which app it belongs to.
      //
      // The port is a constant, so any build that embeds this server binds it -- the demo app
      // and a real app under test both answer on 8765, and whichever launched first wins. The
      // capture loop would then drive one app while reporting screens from another, with
      // entirely plausible numbers. That happened here, and only a differing screen count made
      // it visible; between two builds of the SAME app it would be invisible. `swift-capture.ts`
      // checks `bundle_id` against the app it just launched and refuses a mismatch.
      case "/screens":
        let rows = ScreenRegistry.names.map { name -> String in
          let req = (ScreenRegistry.requirements[name] ?? []).map { "\"\($0)\"" }.joined(separator: ",")
          return "{\"name\":\"\(name)\",\"requires\":[\(req)]}"
        }
        let bundle = Bundle.main.bundleIdentifier ?? "unknown"
        json("{\"bundle_id\":\"\(bundle)\",\"screens\":[\(ScreenRegistry.names.map { "\"\($0)\"" }.joined(separator: ","))],\"detail\":[\(rows.joined(separator: ","))]}")

      case "/present":
        guard let screen = q["screen"] else { json("{\"error\":\"screen required\"}"); return }
        guard ScreenRegistry.entries[screen] != nil else {
          // `refusal` says what the caller got wrong, because the two kinds call for opposite
          // responses: a screen this build does not have is one screen's answer, while a mode or
          // signal it does not have makes every remaining screen's answer wrong the same way.
          json("{\"error\":\"no registry entry\",\"refusal\":\"screen\",\"screen\":\"\(screen)\"}")
          return
        }
        var o = PresentOptions()
        // A mode or signal this build does not have is refused, not quietly swapped for the
        // default. `window` lived only in the IceCubesApp port for a while, and a sweep asking
        // this harness for it got `overlay` and no warning -- a different presentation, measured
        // and reported as the one requested. The same hazard applies to the signal: a run asking
        // for `stable` and silently getting `idle` reports a number for a signal it never waited
        // on. An absent parameter still means the default; a present, unknown one is an error.
        if let requested = q["mode"] {
          guard let mode = PresentationMode(rawValue: requested) else {
            json("{\"error\":\"unknown mode\",\"refusal\":\"mode\",\"mode\":\"\(requested)\"}")
            return
          }
          o.mode = mode
        }
        if let requested = q["signal"] {
          guard let signal = ReadinessSignal(rawValue: requested) else {
            json("{\"error\":\"unknown signal\",\"refusal\":\"signal\",\"signal\":\"\(requested)\"}")
            return
          }
          o.waitFor = signal
        }
        o.nav = (q["nav"] ?? "1") != "0"
        o.observeAll = (q["observe_all"] ?? "0") == "1"
        if let v = q["budget_ms"].flatMap(Double.init) { o.tuning.budgetMs = v }
        if let v = q["sample_ms"].flatMap(Double.init) { o.tuning.sampleMs = v }
        if let v = q["stable_threshold"].flatMap(Double.init) { o.tuning.stableThreshold = v }
        if let v = q["stable_quiet_ms"].flatMap(Double.init) { o.tuning.stableQuietMs = v }
        if let v = q["idle_quiet_ms"].flatMap(Double.init) { o.tuning.idleQuietMs = v }
        if let v = q["thumb_w"].flatMap(Int.init) { o.tuning.thumbW = v }
        if let v = q["thumb_h"].flatMap(Int.init) { o.tuning.thumbH = v }
        let waited = o.waitFor.rawValue
        c.present(screen, options: o) { log in
          let fired = log.time(of: o.waitFor)
          let env = EnvironmentAudit.verdict(for: screen)
          let sat = (env?.satisfied ?? []).map { "\"\($0)\"" }.joined(separator: ",")
          let miss = (env?.missing ?? []).map { "\"\($0)\"" }.joined(separator: ",")
          // Reported beside `missing`, never folded into it: see `EnvironmentAudit.advisory`.
          let advisory = EnvironmentAudit.advisory(for: screen)
            .map { "\"\($0)\"" }.joined(separator: ",")
          json("""
          {"screen":"\(screen)","mode":"\(o.mode.rawValue)","nav":\(o.nav),\
          "waited_for":"\(waited)","fired":\(fired != nil),\
          "wait_ms":\(fired.map { String(format: "%.1f", $0) } ?? "null"),\
          "signals":\(log.json),\
          "env":{"satisfied":[\(sat)],"missing":[\(miss)],"advisory":[\(advisory)]},\
          "generation":\(c.generation)}
          """)
        }

      // What the parser refused to construct, carried through codegen into the binary.
      // A run reports this alongside the captures: a smaller map than the app has is only
      // honest if it says which screens are absent and why.
      case "/missing":
        let rows = ScreenRegistry.missing.keys.sorted().map { view -> String in
          let why = (ScreenRegistry.missing[view] ?? []).map { "\"\($0)\"" }.joined(separator: ",")
          return "{\"view\":\"\(view)\",\"missing\":[\(why)]}"
        }
        json("{\"missing\":[\(rows.joined(separator: ","))]}")

      case "/dismiss":
        c.dismiss()
        json("{\"ok\":true}")

      // Clears the harness's own work ledger only. App state is reset by relaunching
      // the process; nothing here can put an app's stores back to their launch values
      // without the app conforming to a protocol of ours.
      case "/reset":
        WorkTracker.shared.reset()
        json("{\"ok\":true,\"outstanding\":\(WorkTracker.shared.total)}")

      case "/hud":
        HUDVisibility.shared.visible = (q["on"] ?? "1") != "0"
        json("{\"hud\":\(HUDVisibility.shared.visible)}")

      case "/snapshot":
        let kind = SnapshotKind(rawValue: q["kind"] ?? "layer") ?? .layer
        let scale = q["scale"].flatMap(Double.init).map { CGFloat($0) } ?? 0
        let t0 = CFAbsoluteTimeGetCurrent()
        let snapNav = (q["nav"] ?? "1") != "0"
        guard let img = Raster.image(kind: kind, scale: scale, screen: c.screen, nav: snapNav),
              let png = img.pngData() else {
          json("{\"error\":\"snapshot failed\",\"kind\":\"\(kind.rawValue)\"}"); return
        }
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        appflowLog.notice("snapshot \(kind.rawValue, privacy: .public) \(ms)ms \(png.count)B")
        if (q["meta"] ?? "0") == "1" {
          json("{\"kind\":\"\(kind.rawValue)\",\"ms\":\(String(format: "%.1f", ms)),\"bytes\":\(png.count),\"w\":\(Int(img.size.width)),\"h\":\(Int(img.size.height)),\"scale\":\(img.scale)}")
        } else {
          raw(png, "image/png")
        }

      case "/env":
        let esc = EnvironmentAudit.dump
          .replacingOccurrences(of: "\\", with: "\\\\")
          .replacingOccurrences(of: "\"", with: "\\\"")
          .replacingOccurrences(of: "\n", with: " ")
        let keys = EnvironmentAudit.installedKeys.map { "\"\($0.replacingOccurrences(of: "\"", with: ""))\"" }
        json("{\"generation\":\(EnvironmentAudit.dumpGeneration),\"keys\":[\(keys.joined(separator: ","))],\"dump\":\"\(esc)\"}")

      case "/state":
        let s = AppEnvironmentProbe.shared.snapshot()
        json("""
        {"screen":\(c.screen.map { "\"\($0)\"" } ?? "null"),"generation":\(c.generation),\
        "tapCount":\(s.tapCount),"feedPosts":\(s.feedPosts),"orderStage":\(s.orderStage),\
        "inboxMessages":\(s.inboxMessages),"outstanding":\(WorkTracker.shared.total)}
        """)

      default:
        json("{\"error\":\"unknown route\",\"path\":\"\(route)\"}")
      }
    }
  }
}

/// Lets the control channel read app-root state without owning it, so we can
/// check from the host whether state leaked between captures.
@MainActor
final class AppEnvironmentProbe {
  static let shared = AppEnvironmentProbe()
  var read: (() -> (Int, Int, Int, Int))?

  func snapshot() -> (tapCount: Int, feedPosts: Int, orderStage: Int, inboxMessages: Int) {
    guard let r = read?() else { return (-1, -1, -1, -1) }
    return (r.0, r.1, r.2, r.3)
  }
}
