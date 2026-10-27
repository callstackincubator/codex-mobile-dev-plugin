import Testing
import Foundation
import Mockable
@testable import Baguette

@Suite("Definition diagnostics")
struct DefinitionDiagnosticsTests {
    @Test(arguments: ["profile_read", "profile_parse", "profile_chrome_identifier", "panel_lookup",
                      "chrome_read", "chrome_parse", "composite_read", "composite_layout",
                      "composite_rasterize", "screen_geometry", "slice_read", "slice_rasterize"])
    func actualAssetFailure(stage: String) throws {
        let store = MockChromeStore()
        let rasterizer = MockPDFRasterizer()
        let diagnostics = DefinitionDiagnostics()
        let storeGiven = given(store)
        let rasterizerGiven = given(rasterizer)
        let missing = CocoaError(.fileReadNoSuchFile, userInfo: [NSFilePathErrorKey: "/Users/private/asset"])
        let capabilities = storeGiven.capabilitiesPlistData(deviceName: .any)
        capabilities.willThrow(missing)
        let mask = storeGiven.framebufferMaskPDF(identifier: .any)
        mask.willThrow(missing)
        if stage == "profile_read" {
            let profileFailure = storeGiven.profilePlistData(deviceName: .any)
            profileFailure.willThrow(missing)
        } else {
            let profile: Data
            if stage == "profile_parse" { profile = Data("PRIVATE_INVALID_PLIST".utf8) }
            else if stage == "profile_chrome_identifier" {
                profile = try PropertyListSerialization.data(fromPropertyList: [:], format: .xml, options: 0)
            } else {
                let width: Int? = stage == "screen_geometry" ? nil : 390
                let height: Int? = stage == "screen_geometry" ? nil : 844
                profile = LiveChromesTests.makePlist(chromeIdentifier: "phone11", width: width, height: height, scale: 1)
            }
            let profileSuccess = storeGiven.profilePlistData(deviceName: .any)
            profileSuccess.willReturn(profile)
        }
        if stage == "chrome_read" {
            let chromeFailure = storeGiven.chromeJSONData(chromeIdentifier: .any)
            chromeFailure.willThrow(missing)
        }
        else {
            let json: Data
            if stage == "chrome_parse" { json = Data("PRIVATE_INVALID_JSON".utf8) }
            else if stage == "composite_layout" { json = LiveChromesTests.fixtureChromeJSONNoComposite }
            else if stage == "screen_geometry" || stage == "slice_read" || stage == "slice_rasterize" {
                json = LiveChromesTests.fixtureChromeJSONSliceOnly
            } else { json = LiveChromesTests.fixtureChromeJSON }
            let chromeSuccess = storeGiven.chromeJSONData(chromeIdentifier: .any)
            chromeSuccess.willReturn(json)
        }
        if stage == "composite_read" || stage == "slice_read" {
            let assetFailure = storeGiven.chromeAssetPDF(chromeIdentifier: .any, imageName: .any)
            assetFailure.willThrow(missing)
        } else {
            let pdf = Data("PDF".utf8)
            let assetSuccess = storeGiven.chromeAssetPDF(chromeIdentifier: .any, imageName: .any)
            assetSuccess.willReturn(pdf)
        }
        let rasterization = rasterizerGiven.rasterize(pdfData: .any)
        rasterization.willThrow(PDFRasterizerError.invalidPDF)
        let composition = rasterizerGiven.compose9Slice(pdfs: .any, insets: .any, innerSize: .any)
        composition.willThrow(PDFRasterizerError.rasterFailed)
        let chromes = LiveChromes(store: store, rasterizer: rasterizer)
        let panel: IntegratedPanel = stage == "panel_lookup" ? .secondary : .primary
        let assets = chromes.assets(forDeviceName: "iPhone 17", panel: panel, diagnostics: diagnostics)
        #expect(assets == nil)
        let payload = diagnostics.payload
        #expect(payload["stage"] == stage)
        let repeatedDiagnostics = DefinitionDiagnostics()
        let repeated = chromes.assets(forDeviceName: "iPhone 17", panel: panel, diagnostics: repeatedDiagnostics)
        #expect(repeated == nil)
        #expect(repeatedDiagnostics.payload["stage"] == stage)
        let uncached = ["profile_read", "profile_parse", "profile_chrome_identifier", "panel_lookup"]
        let expectedCached = uncached.contains(stage) ? "false" : "true"
        #expect(repeatedDiagnostics.payload["cached_failure"] == expectedCached)
        let data = try JSONSerialization.data(withJSONObject: payload)
        let encoded = String(decoding: data, as: UTF8.self)
        #expect(encoded.contains("PRIVATE_") == false)
        #expect(encoded.contains("/Users/private") == false)
    }

    @Test func negativeCacheKeepsFailuresFromOtherChromeConsumers() {
        let store = MockChromeStore()
        let storeGiven = given(store)
        let missing = CocoaError(.fileReadNoSuchFile)
        let capabilities = storeGiven.capabilitiesPlistData(deviceName: .any)
        capabilities.willThrow(missing)
        let profileData = LiveChromesTests.makePlist(chromeIdentifier: "phone11")
        let profile = storeGiven.profilePlistData(deviceName: .any)
        profile.willReturn(profileData)
        let chrome = storeGiven.chromeJSONData(chromeIdentifier: .any)
        chrome.willThrow(missing)
        let rasterizer = MockPDFRasterizer()
        let chromes = LiveChromes(store: store, rasterizer: rasterizer)
        let original = chromes.assets(forDeviceName: "iPhone 17")
        #expect(original == nil)
        let diagnostics = DefinitionDiagnostics()
        let repeated = chromes.assets(forDeviceName: "iPhone 17", panel: .primary, diagnostics: diagnostics)
        #expect(repeated == nil)
        #expect(diagnostics.payload["stage"] == "chrome_read")
        #expect(diagnostics.payload["failure"] == "missing")
        #expect(diagnostics.payload["cached_failure"] == "true")
    }

    @Test func missingSimulatorIsDistinctFromAssets() {
        let simulators = MockSimulators()
        let simulatorGiven = given(simulators)
        let lookup = simulatorGiven.find(udid: .any)
        lookup.willReturn(nil)
        let chromes = MockChromes()
        let diagnostics = DefinitionDiagnostics()
        let definition = Server.definitionJSONString(udid: "PRIVATE_UDID", simulators: simulators,
                                                     chromes: chromes, diagnostics: diagnostics)
        #expect(definition == nil)
        #expect(diagnostics.payload["stage"] == "simulator_lookup")
        #expect(diagnostics.payload["failure"] == "missing")
        #expect(diagnostics.payload["model"] == "unknown")
    }

    @Test func permissionFailureKeepsOnlyACategory() {
        let diagnostics = DefinitionDiagnostics()
        let error = CocoaError(.fileReadNoPermission, userInfo: [NSFilePathErrorKey: "/Users/private/asset"])
        diagnostics.recordRead("profile_read", error)
        #expect(diagnostics.payload["failure"] == "permission_denied")
    }
}
