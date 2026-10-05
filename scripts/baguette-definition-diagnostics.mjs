import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function replaceOnce(source, before, after) {
  const index = source.indexOf(before);
  const repeated = source.indexOf(before, index + before.length);
  if (index < 0 || repeated >= 0) throw new Error("The pinned Baguette definition diagnostic integration point changed.");
  return source.replace(before, after);
}

export async function addDefinitionDiagnostics(source, release) {
  const template = await readFile("native/baguette/DefinitionDiagnostics.swift", "utf8");
  const withVersion = template.replace("__BAGUETTE_VERSION__", release.version);
  const helper = withVersion.replace("__BAGUETTE_SOURCE__", release.rebuild.sourceCommit);
  const helperPath = join(source, "Sources/Baguette/Infrastructure/Chrome/DefinitionDiagnostics.swift");
  await writeFile(helperPath, helper);
  const testPath = join(source, "Tests/BaguetteTests/Chrome/LiveChromesTests.swift");
  const originalTests = await readFile(testPath, "utf8");
  const diagnosticTests = await readFile("native/baguette/DefinitionDiagnosticsTests.swift", "utf8");
  await writeFile(testPath, originalTests + "\n" + diagnosticTests);
  const chromePath = join(source, "Sources/Baguette/Infrastructure/Chrome/LiveChromes.swift");
  let chrome = await readFile(chromePath, "utf8");
  chrome = replaceOnce(chrome,
    "        guard let profile = resolveProfile(deviceName: deviceName)?.panel(panel) else {",
    `        return assets(forDeviceName: deviceName, panel: panel, diagnostics: nil)
    }

    func assets(forDeviceName deviceName: String, panel: IntegratedPanel,
                diagnostics: DefinitionDiagnostics?) -> DeviceChromeAssets? {
        guard let deviceProfile = resolveProfile(deviceName: deviceName, diagnostics: diagnostics) else { return nil }
        guard let profile = deviceProfile.panel(panel) else {
            diagnostics?.record("panel_lookup", "missing")`);
  chrome = replaceOnce(chrome, "loadAssets(chromeIdentifier: chromeID, profile: profile)",
    "loadAssets(chromeIdentifier: chromeID, profile: profile, diagnostics: diagnostics)");
  chrome = replaceOnce(chrome, "    private var cache: [String: DeviceChromeAssets?] = [:]",
    "    private var cache: [String: DeviceChromeAssets?] = [:]\n    private var cacheFailures: [String: (stage: String, failure: String)] = [:]");
  chrome = replaceOnce(chrome, `        if let cached = cache[key] {
            lock.unlock()
            return cached
        }`, `        if let cached = cache[key] {
            if let reason = cacheFailures[key] {
                diagnostics?.record(reason.stage, reason.failure)
                diagnostics?.cachedFailure = true
            }
            lock.unlock()
            return cached
        }`);
  chrome = replaceOnce(chrome, `        let resolved = loadAssets(chromeIdentifier: chromeID, profile: profile, diagnostics: diagnostics)
            .map { $0.withScreenMask(screenMask(for: profile)) }`, `        let resolutionDiagnostics = diagnostics ?? DefinitionDiagnostics()
        let loaded = loadAssets(chromeIdentifier: chromeID, profile: profile, diagnostics: resolutionDiagnostics)
        let resolved = loaded.map { $0.withScreenMask(screenMask(for: profile)) }`);
  chrome = replaceOnce(chrome, "        cache[key] = resolved\n        lock.unlock()",
    `        cache[key] = resolved
        if resolved == nil { cacheFailures[key] = resolutionDiagnostics.failureReason }
        lock.unlock()`);
  const profileStart = chrome.indexOf("    private func resolveProfile(");
  const profileEnd = chrome.indexOf("    private func loadAssets(", profileStart);
  if (profileStart < 0 || profileEnd < 0) throw new Error("Baguette profile diagnostic integration point changed.");
  const beforeProfile = chrome.slice(0, profileStart);
  const afterProfile = chrome.slice(profileEnd);
  chrome = beforeProfile + `    private func resolveProfile(deviceName: String,
                                diagnostics: DefinitionDiagnostics? = nil) -> DeviceProfile? {
        let plistData: Data
        do { plistData = try store.profilePlistData(deviceName: deviceName) }
        catch {
            diagnostics?.recordRead("profile_read", error)
            return nil
        }
        let capabilities = try? store.capabilitiesPlistData(deviceName: deviceName)
        do {
            return try DeviceProfile.parsing(plistData: plistData, capabilitiesData: capabilities)
        } catch {
            if let parseError = error as? DeviceProfileParseError,
               parseError == .missingChromeIdentifier {
                diagnostics?.record("profile_chrome_identifier", "missing")
            } else {
                diagnostics?.record("profile_parse", "invalid")
            }
            return nil
        }
    }

` + afterProfile;
  chrome = replaceOnce(chrome, "        profile: DeviceProfile.PanelProfile\n    ) -> DeviceChromeAssets? {",
    "        profile: DeviceProfile.PanelProfile,\n        diagnostics: DefinitionDiagnostics?\n    ) -> DeviceChromeAssets? {");
  chrome = replaceOnce(chrome, `        do {
            let json = try store.chromeJSONData(chromeIdentifier: chromeIdentifier)
            chrome = try DeviceChrome.parsing(json: json)
        } catch {
            return nil
        }`, `        let json: Data
        do { json = try store.chromeJSONData(chromeIdentifier: chromeIdentifier) }
        catch {
            diagnostics?.recordRead("chrome_read", error)
            return nil
        }
        do { chrome = try DeviceChrome.parsing(json: json) }
        catch {
            diagnostics?.record("chrome_parse", "invalid")
            return nil
        }`);
  chrome = replaceOnce(chrome, "            profile: profile\n        ) else {", "            profile: profile, diagnostics: diagnostics\n        ) else {");
  chrome = replaceOnce(chrome, `        } catch {
            return nil
        }
    }

    /// Resolve a \`DeviceChrome\``, `        } catch {
            diagnostics?.record("assembly", "failed")
            return nil
        }
    }

    /// Resolve a \`DeviceChrome\``);
  chrome = replaceOnce(chrome, "        profile: DeviceProfile.PanelProfile\n    ) -> ChromeImage? {",
    "        profile: DeviceProfile.PanelProfile,\n        diagnostics: DefinitionDiagnostics?\n    ) -> ChromeImage? {");
  const compositeStart = chrome.indexOf("        if let imageName = chrome.compositeImageName,");
  const compositeEnd = chrome.indexOf("    /// Read all nine PDF assets", compositeStart);
  if (compositeStart < 0 || compositeEnd < 0) throw new Error("Baguette composite diagnostic integration point changed.");
  const beforeComposite = chrome.slice(0, compositeStart);
  const afterComposite = chrome.slice(compositeEnd);
  chrome = beforeComposite + `        if let imageName = chrome.compositeImageName {
            let pdf: Data?
            do { pdf = try store.chromeAssetPDF(chromeIdentifier: chromeIdentifier, imageName: imageName) }
            catch {
                diagnostics?.recordRead("composite_read", error)
                pdf = nil
            }
            if let pdf {
                do { return try rasterizer.rasterize(pdfData: pdf) }
                catch { diagnostics?.record("composite_rasterize", "failed") }
            }
        } else {
            diagnostics?.record("composite_layout", "unsupported")
        }
        guard let slice = chrome.slice else { return nil }
        guard let innerSize = profile.screenSize else {
            diagnostics?.record("screen_geometry", "missing")
            return nil
        }
        guard let pdfs = loadSlicePDFs(chromeIdentifier: chromeIdentifier, slice: slice,
                                      diagnostics: diagnostics) else { return nil }
        do {
            return try rasterizer.compose9Slice(pdfs: pdfs, insets: chrome.screenInsets, innerSize: innerSize)
        } catch {
            diagnostics?.record("slice_rasterize", "failed")
            return nil
        }
    }

` + afterComposite;
  chrome = replaceOnce(chrome, "        slice: DeviceChromeSlice\n    ) -> NineSlicePDFs? {",
    "        slice: DeviceChromeSlice,\n        diagnostics: DefinitionDiagnostics?\n    ) -> NineSlicePDFs? {");
  chrome = replaceOnce(chrome, `        } catch {
            return nil
        }
    }

    /// Rasterize the chrome's`, `        } catch {
            diagnostics?.recordRead("slice_read", error)
            return nil
        }
    }

    /// Rasterize the chrome's`);
  await writeFile(chromePath, chrome);
  const serverPath = join(source, "Sources/Baguette/Infrastructure/Server/Server.swift");
  let server = await readFile(serverPath, "utf8");
  server = replaceOnce(server, `        guard let json = definitionJSONString(
            udid: udid, simulators: simulators, chromes: chromes, panel: panel
        ) else {
            return errorJSON("no definition for udid \\(udid)", status: .notFound)
        }`, `        let diagnostics = DefinitionDiagnostics()
        guard let json = definitionJSONString(
            udid: udid, simulators: simulators, chromes: chromes, panel: panel,
            diagnostics: diagnostics
        ) else {
            let body: [String: Any] = ["ok": false, "error": "no definition for udid \\(udid)",
                                       "definition_diagnostic": diagnostics.payload]
            let data = try! JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
            let buffer = ByteBuffer(data: data)
            let responseBody = ResponseBody(byteBuffer: buffer)
            return Response(status: .notFound, headers: [.contentType: "application/json"], body: responseBody)
        }`);
  server = replaceOnce(server, `        panel pinned: IntegratedPanel? = nil
    ) -> String? {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid) else { return nil }`, `        panel pinned: IntegratedPanel? = nil,
        diagnostics: DefinitionDiagnostics? = nil
    ) -> String? {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid) else {
            diagnostics?.record("simulator_lookup", "missing")
            return nil
        }
        diagnostics?.model = sim.deviceTypeName
        diagnostics?.runtime = sim.runtime
        diagnostics?.state = sim.state.description`);
  server = replaceOnce(server, `        switch panel {
        case .primary:   assets = chromes.assets(forDeviceName: sim.deviceTypeName)
        case .secondary: assets = chromes.assets(forDeviceName: sim.deviceTypeName, panel: .secondary)
        }
        guard let assets else { return nil }`, `        diagnostics?.panel = panel == .primary ? "primary" : "secondary"
        if let live = chromes as? LiveChromes {
            assets = live.assets(forDeviceName: sim.deviceTypeName, panel: panel, diagnostics: diagnostics)
        } else {
            switch panel {
            case .primary: assets = chromes.assets(forDeviceName: sim.deviceTypeName)
            case .secondary: assets = chromes.assets(forDeviceName: sim.deviceTypeName, panel: .secondary)
            }
        }
        guard let assets else { return nil }`);
  await writeFile(serverPath, server);
}
