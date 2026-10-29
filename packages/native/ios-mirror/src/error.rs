//! Typed capture failures with stable codes for the Node-API boundary.
//!
//! napi-rs rejects async calls with its own status as the JavaScript `code`, so
//! the addon prefixes each message with `[code] `. `openNativeIosCapture` in
//! packages/core/src/ios-native-capture.ts strips the prefix, sets `error.code`
//! and maps expected device states to `ExpectedOperationError`.

use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorCode {
    /// usbmuxd does not list the iPhone.
    DeviceNotFound,
    ConnectTimeout,
    ConnectFailed,
    /// The device lacks the display service, usually because Developer Mode is off.
    DisplayServiceUnavailable,
    TouchServiceUnavailable,
    /// The display service failed without a CoreDevice error, or answered invalidly.
    DisplayServiceFailed,
    /// CoreDevice refused the request with this error code, e.g. 9022 while a call is in progress.
    CoreDevice(i64),
    /// CoreDevice refused the request without a numeric code.
    CoreDeviceUnknown,
    NegotiationFailed,
    StartTimeout,
    StopTimeout,
    StreamFailed,
    StreamClosed,
    InputInvalid,
    /// Input targets a screen generation the device no longer shows.
    InputStale,
    InputUnavailable,
    InputTimeout,
    InputFailed,
    Internal,
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::CoreDevice(code) => return write!(formatter, "core_device_{code}"),
            Self::DeviceNotFound => "device_not_found",
            Self::ConnectTimeout => "connect_timeout",
            Self::ConnectFailed => "connect_failed",
            Self::DisplayServiceUnavailable => "display_service_unavailable",
            Self::TouchServiceUnavailable => "touch_service_unavailable",
            Self::DisplayServiceFailed => "display_service_failed",
            Self::CoreDeviceUnknown => "core_device_unknown",
            Self::NegotiationFailed => "negotiation_failed",
            Self::StartTimeout => "start_timeout",
            Self::StopTimeout => "stop_timeout",
            Self::StreamFailed => "stream_failed",
            Self::StreamClosed => "stream_closed",
            Self::InputInvalid => "input_invalid",
            Self::InputStale => "input_stale",
            Self::InputUnavailable => "input_unavailable",
            Self::InputTimeout => "input_timeout",
            Self::InputFailed => "input_failed",
            Self::Internal => "internal",
        };
        formatter.write_str(name)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MirrorError {
    pub code: ErrorCode,
    pub message: String,
}

impl MirrorError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        let message = message.into();
        Self { code, message }
    }

    /// Wraps a lower-level error's text under `code`.
    pub fn from_display<E: fmt::Display>(code: ErrorCode) -> impl FnOnce(E) -> Self {
        move |error| Self::new(code, error.to_string())
    }

    /// The Node-API error reason: `[code] message`.
    pub fn reason(&self) -> String {
        format!("[{}] {}", self.code, self.message)
    }
}

impl fmt::Display for MirrorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

pub type Result<T> = std::result::Result<T, MirrorError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_stable_snake_case_and_keep_core_device_numbers() {
        assert_eq!(ErrorCode::DisplayServiceUnavailable.to_string(), "display_service_unavailable");
        assert_eq!(ErrorCode::CoreDevice(9022).to_string(), "core_device_9022");
        assert_eq!(ErrorCode::CoreDevice(-1).to_string(), "core_device_-1");
        let error = MirrorError::new(ErrorCode::InputStale, "Wait for a fresh physical iOS screen before sending input.");
        assert_eq!(error.reason(), "[input_stale] Wait for a fresh physical iOS screen before sending input.");
        assert_eq!(error.to_string(), "Wait for a fresh physical iOS screen before sending input.");
    }
}
