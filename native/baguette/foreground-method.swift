    func foregroundPid() throws -> Int32? {
        guard Self.isAvailable, let translator = Self.sharedTranslator else {
            throw NSError(domain: "MobileDevForeground", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Simulator accessibility bridge is unavailable"])
        }
        guard let device = resolveDevice() else {
            throw NSError(domain: "MobileDevForeground", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Selected simulator not found"])
        }
        let token = UUID().uuidString
        let now = Date()
        let deadline = now.addingTimeInterval(Self.xpcTimeoutSeconds)
        Self.sharedDispatcher.register(device: device, token: token, deadline: deadline)
        defer { Self.sharedDispatcher.unregister(token: token) }
        guard let translation = Self.frontmostApplication(translator: translator, token: token) else {
            throw NSError(domain: "MobileDevForeground", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Simulator did not return a foreground application"])
        }
        let selector = NSSelectorFromString("pid")
        guard translation.responds(to: selector),
              let value = translation.value(forKey: "pid") as? NSNumber else {
            throw NSError(domain: "MobileDevForeground", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "Simulator returned an unsupported foreground application"])
        }
        let pid = value.int32Value
        guard pid > 0 else { return nil }
        return pid
    }

