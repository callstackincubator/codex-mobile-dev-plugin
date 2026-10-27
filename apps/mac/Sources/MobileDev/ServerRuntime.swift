import Foundation

/// The Node executable and server script bundled in the app's resources.
struct ServerRuntime {
  let node: URL
  let server: URL

  /// Finds the runtime `tooling/build-mac.mjs` places under `Contents/Resources`.
  static func bundled(in bundle: Bundle = .main) throws -> ServerRuntime {
    guard let resources = bundle.resourceURL else { throw ServerRuntimeError.missing("the app's resources") }
    let runtime = ServerRuntime(
      node: resources.appending(path: "node/node"),
      server: resources.appending(path: "runtime/server.mjs"))
    let files = FileManager.default
    guard files.isExecutableFile(atPath: runtime.node.path) else { throw ServerRuntimeError.missing("the bundled Node runtime") }
    guard files.fileExists(atPath: runtime.server.path) else { throw ServerRuntimeError.missing("the bundled server") }
    return runtime
  }
}
