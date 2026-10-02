import ArgumentParser
import Foundation

struct ForegroundCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "foreground",
        abstract: "Read the screen-owning simulator process without walking its UI tree"
    )

    @OptionGroup var options: DeviceOption

    func run() async throws {
        let simulators = CoreSimulators(deviceSetPath: options.deviceSet)
        guard let simulator = simulators.find(udid: options.udid) else {
            throw ValidationError("Selected simulator not found")
        }
        let accessibility = simulator.accessibility()
        guard let translator = accessibility as? AXPTranslatorAccessibility else {
            throw ValidationError("Simulator foreground detection is unavailable")
        }
        let pid = try translator.foregroundPid()
        let value: Any
        if let pid {
            value = NSNumber(value: pid)
        } else {
            value = NSNull()
        }
        let data = try JSONSerialization.data(withJSONObject: ["pid": value])
        try FileHandle.standardOutput.write(contentsOf: data)
        let newline = Data("\n".utf8)
        try FileHandle.standardOutput.write(contentsOf: newline)
    }
}
