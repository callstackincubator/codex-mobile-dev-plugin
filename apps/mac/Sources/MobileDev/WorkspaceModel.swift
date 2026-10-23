import Foundation
import Observation
import os

/// The window's state: the sidebar selection, the server it runs, and the page that renders the tools.
@MainActor
@Observable
final class WorkspaceModel {
  private(set) var tool: Tool? = .logs
  /// The page chooses the first layout from the devices it finds and reports it.
  private(set) var layout: DeviceLayout = .none
  private(set) var status: ServerStatus = .starting {
    didSet { log.info("Status: \(self.status.label, privacy: .public)") }
  }
  @ObservationIgnored private let log = Logger(subsystem: "com.callstack.mobile-dev", category: "workspace")
  @ObservationIgnored let page = PageBridge()
  @ObservationIgnored private var server: ServerProcess?
  @ObservationIgnored private var loader: PageLoader?

  init() {
    page.onServerMessage = { [weak self] line in self?.server?.send(line) }
    page.onShellMessage = { [weak self] message in self?.handle(message) }
    start()
  }

  func select(tool: Tool?) {
    guard tool != self.tool else { return }
    self.tool = tool
    page.select(tool: tool)
  }

  func setShowsIOS(_ shows: Bool) { select(layout: DeviceLayout(showsIOS: shows, showsAndroid: layout.showsAndroid)) }
  func setShowsAndroid(_ shows: Bool) { select(layout: DeviceLayout(showsIOS: layout.showsIOS, showsAndroid: shows)) }

  /// Restarts the server and reloads the page, for example after the server exits.
  func restart() {
    server?.stop()
    server = nil
    start()
  }

  func stop() { server?.stop() }

  private func select(layout: DeviceLayout) {
    guard layout != self.layout else { return }
    self.layout = layout
    page.select(layout: layout)
  }

  private func start() {
    status = .starting
    let process: ServerProcess
    do { process = ServerProcess(runtime: try ServerRuntime.bundled()) }
    catch { status = .failed(error.localizedDescription); return }
    let loader = PageLoader(send: { process.send($0) }) { [weak self] result in
      switch result {
      case .success(let html): self?.page.load(html: html)
      case .failure(let error): self?.status = .failed(error.localizedDescription)
      }
    }
    do {
      try process.start(
        onLine: { [weak self] line in self?.receive(line, from: process) },
        onExit: { [weak self] code in self?.exited(process, code: code) })
    } catch {
      status = .failed("Mobile Dev could not start its server: \(error.localizedDescription)")
      return
    }
    server = process
    self.loader = loader
    loader.begin()
  }

  private func receive(_ line: String, from process: ServerProcess) {
    guard process === server else { return }
    if loader?.receive(line) == true { return }
    page.deliver(line)
  }

  private func exited(_ process: ServerProcess, code: Int32) {
    guard process === server else { return }
    server = nil
    status = .failed("The Mobile Dev server stopped (exit status \(code)).")
  }

  private func handle(_ message: ShellMessage) {
    switch message {
    case .ready:
      status = .ready
      // The page starts with no tool; apply the sidebar's. It picks the devices itself.
      page.select(tool: tool)
      SmokeSnapshot.capture(page.webView)
    case .layout(let layout):
      // The page already applied this layout; reflect it without sending it back.
      self.layout = layout
    case .error(let message):
      status = .failed(message)
    }
  }
}
