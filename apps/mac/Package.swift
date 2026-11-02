// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "MobileDev",
  platforms: [.macOS(.v15)],
  targets: [
    .executableTarget(name: "MobileDev", path: "Sources/MobileDev"),
  ]
)
