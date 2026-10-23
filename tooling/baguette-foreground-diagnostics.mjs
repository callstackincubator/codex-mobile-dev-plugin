export function addForegroundTimeoutDiagnostics(adapter) {
  const edits = [
    ["    private var deadlineForToken: [String: Date] = [:]", "    private var deadlineForToken: [String: Date] = [:]\n    private var timedOutTokens = Set<String>()"],
    ["        deadlineForToken.removeValue(forKey: token)", "        deadlineForToken.removeValue(forKey: token)\n        timedOutTokens.remove(token)"],
    ["    private func lookup(token: String)", `    func didTimeOut(token: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return timedOutTokens.contains(token)
    }

    private func markTimedOut(token: String) {
        lock.lock(); defer { lock.unlock() }
        timedOutTokens.insert(token)
    }

    private func lookup(token: String)`],
    ["            if remaining <= 0 { return TokenDispatcher.emptyResponse() }", "            if remaining <= 0 {\n                self.markTimedOut(token: key)\n                return TokenDispatcher.emptyResponse()\n            }"],
    ["                request, to: device, timeout: timeout", "                request, to: device, timeout: timeout, token: key"],
    ["        _ request: AnyObject, to device: NSObject, timeout: Double", "        _ request: AnyObject, to device: NSObject, timeout: Double, token: String"],
    ["        if group.wait(timeout: .now() + timeout) == .timedOut {", "        if group.wait(timeout: .now() + timeout) == .timedOut {\n            markTimedOut(token: token)"],
  ];
  for (const [before, after] of edits) {
    const first = adapter.indexOf(before);
    const next = adapter.indexOf(before, first + before.length);
    if (first < 0 || next >= 0) throw new Error("The pinned Baguette foreground timeout integration point changed.");
    adapter = adapter.replace(before, after);
  }
  return adapter;
}
