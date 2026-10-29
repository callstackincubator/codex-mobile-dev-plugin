//! Opens the CoreDevice developer tunnel to a paired iPhone: usbmuxd lookup
//! (preferring USB), CoreDeviceProxy, the userspace TCP tunnel and the RSD
//! service handshake. Callers keep their own connection labels, deadlines and
//! user-facing messages.

use std::fmt;

use idevice::{IdeviceError, IdeviceService, core_device_proxy::CoreDeviceProxy, rsd::RsdHandshake,
    tcp::handle::AdapterHandle, usbmuxd::{Connection, UsbmuxdAddr}};

const USBMUXD_SOCKET: &str = "/var/run/usbmuxd";

pub struct Tunnel {
    pub handshake: RsdHandshake,
    pub adapter: AdapterHandle,
}

#[derive(Debug)]
pub enum TunnelError {
    /// usbmuxd does not list the requested device.
    DeviceNotFound,
    /// The caller's deadline passed before the tunnel was ready.
    Timeout,
    Usbmuxd(IdeviceError),
    CoreDeviceProxy(IdeviceError),
    SoftwareTunnel(IdeviceError),
    RsdConnect(std::io::Error),
    RsdHandshake(IdeviceError),
}

impl fmt::Display for TunnelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DeviceNotFound => formatter.write_str("the device is not connected"),
            Self::Timeout => formatter.write_str("timed out opening the developer tunnel"),
            Self::Usbmuxd(error) | Self::CoreDeviceProxy(error) | Self::SoftwareTunnel(error) | Self::RsdHandshake(error) => error.fmt(formatter),
            Self::RsdConnect(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for TunnelError {}

async fn step<T, E>(deadline: Option<tokio::time::Instant>, operation: impl Future<Output = Result<T, E>>, error: impl FnOnce(E) -> TunnelError) -> Result<T, TunnelError> {
    let result = match deadline {
        Some(deadline) => tokio::time::timeout_at(deadline, operation).await.map_err(|_| TunnelError::Timeout)?,
        None => operation.await,
    };
    result.map_err(error)
}

/// Opens the tunnel and completes the RSD handshake before `deadline`, if any.
pub async fn open(udid: &str, label: &str, deadline: Option<tokio::time::Instant>) -> Result<Tunnel, TunnelError> {
    let address = UsbmuxdAddr::UnixSocket(USBMUXD_SOCKET.into());
    let mut mux = step(deadline, address.connect(1), TunnelError::Usbmuxd).await?;
    let devices = step(deadline, mux.get_devices(), TunnelError::Usbmuxd).await?;
    let device = devices.iter().filter(|device| device.udid == udid)
        .min_by_key(|device| if device.connection_type == Connection::Usb { 0 } else { 1 })
        .ok_or(TunnelError::DeviceNotFound)?;
    let provider = device.to_provider(address, label);
    let proxy = step(deadline, CoreDeviceProxy::connect(&provider), TunnelError::CoreDeviceProxy).await?;
    let rsd_port = proxy.tunnel_info().server_rsd_port;
    let adapter = proxy.create_software_tunnel().map_err(TunnelError::SoftwareTunnel)?;
    let mut adapter = adapter.to_async_handle();
    let handshake = async {
        let stream = step(deadline, adapter.connect(rsd_port), TunnelError::RsdConnect).await?;
        step(deadline, RsdHandshake::new(stream), TunnelError::RsdHandshake).await
    }.await;
    match handshake {
        Ok(handshake) => Ok(Tunnel { handshake, adapter }),
        Err(error) => {
            let _ = adapter.close().await;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn a_passed_deadline_reports_a_timeout_instead_of_the_step_error() {
        let deadline = tokio::time::Instant::now();
        let pending = std::future::pending::<Result<(), std::io::Error>>();
        let result = step(Some(deadline), pending, TunnelError::RsdConnect).await;
        assert!(matches!(result, Err(TunnelError::Timeout)));
    }

    #[tokio::test]
    async fn steps_keep_their_own_error_and_value() {
        let failing = async { Err::<(), _>(std::io::Error::other("refused")) };
        let result = step(None, failing, TunnelError::RsdConnect).await;
        let Err(error) = result else { panic!("expected the step error") };
        assert_eq!(error.to_string(), "refused");
        let later = Some(tokio::time::Instant::now() + Duration::from_secs(60));
        let succeeding = async { Ok::<_, std::io::Error>(7) };
        assert_eq!(step(later, succeeding, TunnelError::RsdConnect).await.unwrap(), 7);
    }
}
