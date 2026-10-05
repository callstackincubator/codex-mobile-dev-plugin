import Foundation

final class DefinitionDiagnostics {
    private var stage = "chrome_lookup"
    private var failure = "unavailable"
    var model = "unknown"
    var runtime = "unknown"
    var state = "unknown"
    var panel = "unknown"
    var cachedFailure = false

    var failureReason: (stage: String, failure: String) { (stage, failure) }

    func record(_ stage: String, _ failure: String) {
        self.stage = stage
        self.failure = failure
    }

    func recordRead(_ stage: String, _ error: Error) {
        let nativeError = error as NSError
        let failure: String
        if nativeError.domain == NSCocoaErrorDomain {
            switch nativeError.code {
            case NSFileNoSuchFileError, NSFileReadNoSuchFileError: failure = "missing"
            case NSFileReadNoPermissionError: failure = "permission_denied"
            default: failure = "unreadable"
            }
        } else {
            failure = "unreadable"
        }
        record(stage, failure)
    }

    var payload: [String: String] {
        ["schema": "1", "stage": stage, "failure": failure, "model": model,
         "runtime": runtime, "state": state, "panel": panel,
         "cached_failure": cachedFailure ? "true" : "false",
         "xcode_version": Self.xcodeVersion,
         "backend_version": "__BAGUETTE_VERSION__",
         "backend_source": "__BAGUETTE_SOURCE__"]
    }

    private static let xcodeVersion: String = {
        let developer = CoreSimulators.developerDir()
        let developerURL = URL(fileURLWithPath: developer)
        let contents = developerURL.deletingLastPathComponent()
        let infoURL = contents.appendingPathComponent("Info.plist")
        guard let data = try? Data(contentsOf: infoURL),
              let raw = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
              let info = raw as? [String: Any],
              let version = info["CFBundleShortVersionString"] as? String else {
            return "unknown"
        }
        return version
    }()
}
