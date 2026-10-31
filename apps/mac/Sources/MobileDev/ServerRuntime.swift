import Foundation

struct ServerRuntime {
  let node: URL
  let server: URL
  /// The page the window loads. It connects to the server itself and reads its telemetry metadata.
  let page: URL

  /// Finds the runtime `apps/mac/tooling/package.mjs` places under `Contents/Resources`.
  static func bundled(in bundle: Bundle = .main) throws -> ServerRuntime {
    guard let resources = bundle.resourceURL else { throw ServerRuntimeError.missing("the app's resources") }
    let runtime = ServerRuntime(
      node: resources.appending(path: "node/node"),
      server: resources.appending(path: "runtime/server.mjs"),
      page: resources.appending(path: "runtime/mac.html"))
    let files = FileManager.default
    guard files.isExecutableFile(atPath: runtime.node.path) else { throw ServerRuntimeError.missing("the bundled Node runtime") }
    guard files.fileExists(atPath: runtime.server.path) else { throw ServerRuntimeError.missing("the bundled server") }
    guard files.fileExists(atPath: runtime.page.path) else { throw ServerRuntimeError.missing("the Mac page") }
    return runtime
  }
}
