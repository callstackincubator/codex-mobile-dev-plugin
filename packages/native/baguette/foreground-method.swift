    func foregroundPid() throws -> Int32? {
        guard Self.isAvailable, let translator = Self.sharedTranslator else {
            throw ForegroundFailure(cause: .bridgeUnavailable, message: "Simulator accessibility bridge is unavailable")
        }
        guard let device = resolveDevice() else {
            throw ForegroundFailure(cause: .deviceNotFound, message: "Selected simulator not found")
        }
        let token = UUID().uuidString
        let now = Date()
        let deadline = now.addingTimeInterval(Self.xpcTimeoutSeconds)
        Self.sharedDispatcher.register(device: device, token: token, deadline: deadline)
        defer { Self.sharedDispatcher.unregister(token: token) }
        guard let translation = Self.frontmostApplication(translator: translator, token: token) else {
            if Self.sharedDispatcher.didTimeOut(token: token) {
                throw ForegroundFailure(cause: .queryTimeout, message: "Simulator foreground request timed out")
            }
            throw ForegroundFailure(cause: .foregroundUnavailable, message: "Simulator did not return a foreground application")
        }
        let selector = NSSelectorFromString("pid")
        guard translation.responds(to: selector),
              let value = translation.value(forKey: "pid") as? NSNumber else {
            throw ForegroundFailure(cause: .unsupportedResponse, message: "Simulator returned an unsupported foreground application")
        }
        let pid = value.int32Value
        guard pid > 0 else { return nil }
        return pid
    }

