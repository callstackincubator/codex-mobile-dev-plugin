import Foundation

enum ServerRuntimeError: LocalizedError {
  case missing(String)

  var errorDescription: String? {
    switch self {
    case .missing(let part): "Mobile Dev could not find \(part). Rebuild the app with npm run build:mac."
    }
  }
}
