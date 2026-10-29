import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sourcePatch } from "./baguette-source-patch.mjs";

const replaceOnce = sourcePatch("accessibility queue");

// AXPTranslator caches translations in nonatomic mutable dictionaries and processes simulator
// notifications on the main queue, so concurrent tree reads from server threads corrupt them.
// Setup, the tree walk and each hit-test probe take the main queue separately, so gestures
// queued there wait for one step rather than a whole read.
export function confineAccessibilityToMainQueue(adapter) {
  adapter = replaceOnce(adapter,
    `        guard let device = resolveDevice() else {
            logErr("[ax] device not found: \\(udid)")
            return nil
        }

        let token = UUID().uuidString
        let deadline = Date().addingTimeInterval(Self.xpcTimeoutSeconds)
        Self.sharedDispatcher.register(device: device, token: token, deadline: deadline)
        defer { Self.sharedDispatcher.unregister(token: token) }

        guard let translator = Self.sharedTranslator else { return nil }
`,
    `        guard let device = resolveDevice() else {
            logErr("[ax] device not found: \\(udid)")
            return nil
        }
        // Resolving a foldable's lit panel runs simctl and devicectl; keep it off the main queue.
        let panelPointSize = litPanelPointSize()

        let token = UUID().uuidString
        let deadline = Date().addingTimeInterval(Self.xpcTimeoutSeconds)
        Self.sharedDispatcher.register(device: device, token: token, deadline: deadline)
        defer { Self.sharedDispatcher.unregister(token: token) }

        let context = Self.onTranslatorQueue {
            translatorContext(device: device, panelPointSize: panelPointSize, token: token, deadline: deadline)
        }
        guard let context else { return nil }
        return try body(context)
    }

    private func translatorContext(
        device: NSObject, panelPointSize: CGSize?, token: String, deadline: Date
    ) -> AXPContext? {
        guard let translator = Self.sharedTranslator else { return nil }
`);
  adapter = replaceOnce(adapter,
    "        let pointSize = litPanelPointSize() ?? Self.devicePointSize(for: device)",
    "        let pointSize = panelPointSize ?? Self.devicePointSize(for: device)");
  adapter = replaceOnce(adapter,
    `        return try body(AXPContext(
            translator: translator,
            token: token,
            frontmostRoot: frontmostRoot,
            transform: transform,
            deadline: deadline
        ))`,
    `        return AXPContext(
            translator: translator,
            token: token,
            frontmostRoot: frontmostRoot,
            transform: transform,
            deadline: deadline
        )`);
  adapter = replaceOnce(adapter,
    `            Self.stampElementTranslation(token: ctx.token, on: ctx.frontmostRoot)
            Self.stampSubtree(ctx.frontmostRoot, token: ctx.token, depthCap: Self.maxDepth)
            let base = AXNode.walk(
                from: ctx.frontmostRoot,
                transform: ctx.transform,
                depthCap: Self.maxDepth,
                deadline: ctx.deadline
            )`,
    `            let base = Self.onTranslatorQueue {
                Self.stampElementTranslation(token: ctx.token, on: ctx.frontmostRoot)
                Self.stampSubtree(ctx.frontmostRoot, token: ctx.token, depthCap: Self.maxDepth)
                return AXNode.walk(
                    from: ctx.frontmostRoot,
                    transform: ctx.transform,
                    depthCap: Self.maxDepth,
                    deadline: ctx.deadline
                )
            }`);
  adapter = replaceOnce(adapter,
    "    private func discover(at point: Point, ctx: AXPContext, depthCap: Int) -> AXNode? {\n",
    `    private func discover(at point: Point, ctx: AXPContext, depthCap: Int) -> AXNode? {
        Self.onTranslatorQueue { discoverOnTranslatorQueue(at: point, ctx: ctx, depthCap: depthCap) }
    }

    private func discoverOnTranslatorQueue(at point: Point, ctx: AXPContext, depthCap: Int) -> AXNode? {
`);
  return replaceOnce(adapter,
    "    nonisolated(unsafe) static let sharedDispatcher = TokenDispatcher()\n",
    `    nonisolated(unsafe) static let sharedDispatcher = TokenDispatcher()

    /// Runs translator work on the main queue, where AXPTranslator handles notifications.
    static func onTranslatorQueue<T>(_ operation: () throws -> T) rethrows -> T {
        if Thread.isMainThread { return try operation() }
        return try DispatchQueue.main.sync(execute: operation)
    }
`);
}

export async function addAccessibilityQueue(source) {
  const adapterPath = join(source, "Sources/Baguette/Infrastructure/Accessibility/AXPTranslatorAccessibility.swift");
  const adapter = await readFile(adapterPath, "utf8");
  await writeFile(adapterPath, confineAccessibilityToMainQueue(adapter));
}
