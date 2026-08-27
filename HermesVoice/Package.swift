// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HermesVoice",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "HermesVoice",
            path: "Sources/HermesVoice"
        )
    ]
)
