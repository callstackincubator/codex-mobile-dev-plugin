// The Node-API addon only links inside Node, so unit tests build without it;
// the modules below that only it drives are allowed to look unused there.
#[cfg_attr(test, allow(dead_code))]
mod codec;
#[cfg_attr(test, allow(dead_code))]
mod control;
#[cfg_attr(test, allow(dead_code))]
mod error;
#[cfg_attr(test, allow(dead_code))]
mod input;
mod media;
#[cfg_attr(test, allow(dead_code))]
mod queue;
mod recovery;
#[cfg_attr(test, allow(dead_code))]
mod session;
pub use idevice::{IdeviceError, core_device::CoreDeviceError};
#[cfg(not(test))]
mod addon;
