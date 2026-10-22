// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "swift-appflow-parse",
  platforms: [.macOS(.v13)],
  dependencies: [
    .package(url: "https://github.com/swiftlang/swift-syntax.git", "600.0.0"..<"700.0.0"),
  ],
  targets: [
    .executableTarget(
      name: "swift-appflow-parse",
      dependencies: [
        .product(name: "SwiftSyntax", package: "swift-syntax"),
        .product(name: "SwiftParser", package: "swift-syntax"),
      ]
    )
  ]
)
