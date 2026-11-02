import Foundation

struct ForegroundFailure: Error, LocalizedError {
    enum Cause: String {
        case deviceNotFound = "device_not_found"
        case bridgeUnavailable = "bridge_unavailable"
        case foregroundUnavailable = "foreground_unavailable"
        case unsupportedResponse = "unsupported_response"
        case queryFailed = "query_failed"
        case queryTimeout = "query_timeout"
    }

    let cause: Cause
    let message: String
    var errorDescription: String? { message }

    static func report(_ error: Error) {
        let failure = error as? ForegroundFailure
        let cause = failure?.cause ?? .queryFailed
        let payload: [String: Any] = ["version": 1, "cause": cause.rawValue]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        var output = Data("mobile-dev-foreground-error:".utf8)
        output.append(data)
        output.append(0x0a)
        try? FileHandle.standardError.write(contentsOf: output)
    }
}
