use std::{io::{self, Write}, time::Duration};
use idevice::{IdeviceService, RsdService, core_device_proxy::CoreDeviceProxy,
    dvt::{message::AuxValue, remote_server::RemoteServerClient},
    debug_proxy::DebugProxyClient,
    rsd::RsdHandshake, usbmuxd::{Connection, UsbmuxdAddr}};
use plist::Value;
use tokio::io::AsyncReadExt;

mod foreground;

const SERVICE: &str = "com.apple.instruments.server.services.graphics.opengl";
const COUNTER: &str = "CoreAnimationFramesPerSecond";

fn fps(value: &Value) -> Result<Option<f64>, String> {
    let Some(dict) = value.as_dictionary() else { return Ok(None); };
    let Some(counter) = dict.get(COUNTER) else { return Ok(None); };
    let number = match counter {
        Value::Real(number) => *number,
        Value::Integer(number) => {
            let unsigned = number.as_unsigned();
            let integer = unsigned.ok_or("Invalid Display FPS counter")?;
            integer as f64
        },
        _ => {
            let message = "Invalid Display FPS counter".into();
            return Err(message);
        },
    };
    if number.is_finite() && number >= 0.0 && number <= 1000.0 {
        let value = Some(number);
        Ok(value)
    } else {
        let message = "Invalid Display FPS counter".into();
        Err(message)
    }
}

async fn connect(udid: &str) -> Result<(RsdHandshake, idevice::tcp::handle::AdapterHandle), String> {
    let _timing = mobile_dev_telemetry::Timer::start(mobile_dev_telemetry::Timing::Connect);
    let socket = "/var/run/usbmuxd".into();
    let address = UsbmuxdAddr::UnixSocket(socket);
    let connected = address.connect(1).await;
    let mut mux = connected.map_err(|error| error.to_string())?;
    let discovery = mux.get_devices().await;
    let devices = discovery.map_err(|error| error.to_string())?;
    let candidates = devices.iter();
    let matches = candidates.filter(|device| device.udid == udid);
    let preferred = matches.min_by_key(|device| if device.connection_type == Connection::Usb { 0 } else { 1 });
    let device = preferred.ok_or("Connect the paired iPhone and enable Developer Mode. Physical iOS performance monitoring requires iOS 17.4 or newer.")?;
    let provider = device.to_provider(address, "mobile-dev-performance");
    let proxy_connection = CoreDeviceProxy::connect(&provider).await;
    let proxy = proxy_connection.map_err(|error| error.to_string())?;
    let info = proxy.tunnel_info();
    let port = info.server_rsd_port;
    let tunnel_creation = proxy.create_software_tunnel();
    let tunnel = tunnel_creation.map_err(|error| error.to_string())?;
    let mut adapter = tunnel.to_async_handle();
    let stream_connection = adapter.connect(port).await;
    let stream = stream_connection.map_err(|error| error.to_string())?;
    let handshake_result = RsdHandshake::new(stream).await;
    let handshake = handshake_result.map_err(|error| error.to_string())?;
    Ok((handshake, adapter))
}

async fn run(udid: &str) -> Result<(), String> {
    let connection_timeout = Duration::from_secs(20);
    let connecting = connect(udid);
    let connection = tokio::time::timeout(connection_timeout, connecting).await;
    let (mut handshake, mut adapter) = connection.map_err(|_| "Timed out connecting to the iPhone")??;
    let client_connection = RemoteServerClient::connect_rsd(&mut adapter, &mut handshake).await;
    let mut client = client_connection.map_err(|error| error.to_string())?;
    let opening = client.make_channel(SERVICE);
    let channel_timeout = Duration::from_secs(5);
    let channel_result = tokio::time::timeout(channel_timeout, opening).await;
    let opened = channel_result.map_err(|_| "Timed out opening the graphics counters")?;
    let mut channel = opened.map_err(|error| error.to_string())?;
    let interval = AuxValue::Double(1.0);
    let args = vec![interval];
    let sampling_method = Some("startSamplingAtTimeInterval:");
    let sampling_args = Some(args);
    let sampling_result = channel.call_method(sampling_method, sampling_args, true).await;
    sampling_result.map_err(|error| error.to_string())?;
    let mut stdin = tokio::io::stdin();
    let mut byte = [0u8; 1];
    let signal_kind = tokio::signal::unix::SignalKind::terminate();
    let signal_result = tokio::signal::unix::signal(signal_kind);
    let mut termination = signal_result.map_err(|error| error.to_string())?;
    let mut baseline = true;
    let result = async {
        loop {
            let sample_timeout = Duration::from_secs(5);
            let incoming = channel.read_message();
            tokio::select! {
                _ = termination.recv() => return Ok(()),
                _ = stdin.read(&mut byte) => return Ok(()),
                received = tokio::time::timeout(sample_timeout, incoming) => {
                    let reading_result = received.map_err(|_| "The iPhone stopped sending Display FPS counters")?;
                    let _timing = mobile_dev_telemetry::Timer::start(mobile_dev_telemetry::Timing::FpsRead);
                    let message = reading_result.map_err(|error| error.to_string())?;
                    let Some(data) = message.data else { continue; };
                    let Some(value) = fps(&data)? else { continue; };
                    // The immediate sample has no complete sampling interval.
                    let reading = if baseline { baseline = false; None } else { Some(value) };
                    let line = serde_json::json!({ "fps": reading });
                    println!("{line}");
                    let mut stdout = io::stdout();
                    let flushed = stdout.flush();
                    flushed.map_err(|error| error.to_string())?;
                }
            }
        }
    }.await;
    let stopping_method = Some("stopSampling");
    let stopping = channel.call_method(stopping_method, None, false);
    let stopping_timeout = Duration::from_secs(2);
    let _ = tokio::time::timeout(stopping_timeout, stopping).await;
    result
}

async fn debugserver(udid: &str) -> Result<(), String> {
    let (mut handshake, mut adapter) = connect(udid).await?;
    let opening = DebugProxyClient::connect_rsd(&mut adapter, &mut handshake).await;
    let proxy = opening.map_err(|error| error.to_string())?;
    let mut remote = proxy.into_inner();
    let binding = tokio::net::TcpListener::bind("127.0.0.1:0").await;
    let listener = binding.map_err(|error| error.to_string())?;
    let address_result = listener.local_addr();
    let address = address_result.map_err(|error| error.to_string())?;
    let port = address.port();
    let ready = serde_json::json!({ "port": port });
    println!("{ready}");
    let mut stdout = io::stdout();
    let flushed = stdout.flush();
    flushed.map_err(|error| error.to_string())?;
    let mut stdin = tokio::io::stdin();
    let mut byte = [0u8; 1];
    let signal_kind = tokio::signal::unix::SignalKind::terminate();
    let signal_result = tokio::signal::unix::signal(signal_kind);
    let mut termination = signal_result.map_err(|error| error.to_string())?;
    let forwarding = async {
        let accepted = listener.accept().await;
        let (mut local, _) = accepted.map_err(|error| error.to_string())?;
        let result = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
        result.map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    };
    tokio::select! {
        result = forwarding => result,
        _ = stdin.read(&mut byte) => Ok(()),
        _ = termination.recv() => Ok(()),
    }
}

#[tokio::main]
async fn main() {
    mobile_dev_telemetry::init("ios-fps");
    let mut args = std::env::args();
    args.next();
    let Some(mode) = args.next() else { eprintln!("Expected fps, debugserver or foreground"); std::process::exit(1); };
    let Some(udid) = args.next() else { eprintln!("Expected a physical iPhone UDID"); std::process::exit(1); };
    let result = match mode.as_str() {
        "fps" => run(&udid).await,
        "debugserver" => debugserver(&udid).await,
        "foreground" => foreground::run(&udid).await,
        _ => Err("Expected fps, debugserver or foreground".into()),
    };
    mobile_dev_telemetry::close();
    if let Err(error) = result { eprintln!("{error}"); std::process::exit(1); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_counters_are_not_zero() {
        let mut dictionary = plist::Dictionary::new();
        let unrelated = "unrelated".into();
        let integer = 10.into();
        let number = Value::Integer(integer);
        dictionary.insert(unrelated, number);
        let snapshot = dictionary.clone();
        let absent = Value::Dictionary(snapshot);
        let absent_fps = fps(&absent);
        assert_eq!(absent_fps, Ok(None));
        let key = COUNTER.into();
        let integer_zero = 0.into();
        let number_zero = Value::Integer(integer_zero);
        dictionary.insert(key, number_zero);
        let snapshot = dictionary.clone();
        let zero = Value::Dictionary(snapshot);
        let zero_fps = fps(&zero);
        let measured_zero = Some(0.0);
        assert_eq!(zero_fps, Ok(measured_zero));
        let key = COUNTER.into();
        let nan = Value::Real(f64::NAN);
        dictionary.insert(key, nan);
        let invalid = Value::Dictionary(dictionary);
        let invalid_fps = fps(&invalid);
        let failed = invalid_fps.is_err();
        assert!(failed);
    }
}
