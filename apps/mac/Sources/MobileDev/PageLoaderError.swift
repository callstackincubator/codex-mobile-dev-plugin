import Foundation

enum PageLoaderError: LocalizedError {
  case server(String)

  var errorDescription: String? {
    switch self {
    case .server(let message): message
    }
  }
}
