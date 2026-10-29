use std::time::Duration;
use idevice::{RsdService, dvt::{message::AuxValue, remote_server::RemoteServerClient}, debug_proxy::DebugProxyClient};
use mobile_dev_device_tunnel::{Tunnel, TunnelError};
use plist::Value;
use protocol::{Exit, Failure, emit};
use serde_json::json;

mod foreground;
mod protocol;

const SERVICE: &str = "com.apple.instruments.server.services.graphics.opengl";
const COUNTER: &str = "CoreAnimationFramesPerSecond";
const USAGE: &str = "Expected fps, debugserver or foreground";

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
    if number.is_finite() && (0.0..=1000.0).contains(&number) {
        let value = Some(number);
        Ok(value)
    } else {
        let message = "Invalid Display FPS counter".into();
        Err(message)
    }
}

pub(crate) const DEVICE_NOT_FOUND: &str = "Connect the paired iPhone and enable Developer Mode. Physical iOS performance monitoring requires iOS 17.4 or newer.";

async fn connect(udid: &str, timeout: Option<Duration>) -> Result<Tunnel, TunnelError> {
    let _timing = mobile_dev_telemetry::Timer::start(mobile_dev_telemetry::Timing::Connect);
    let deadline = timeout.map(|timeout| tokio::time::Instant::now() + timeout);
    mobile_dev_device_tunnel::open(udid, "mobile-dev-performance", deadline).await
}

fn connection_failure(error: TunnelError) -> Failure {
    match error {
        TunnelError::DeviceNotFound => Failure::new("device_not_found", DEVICE_NOT_FOUND),
        TunnelError::Timeout => Failure::new("connection_timeout", "Timed out connecting to the iPhone"),
        error => Failure::new("connection_failed", error.to_string()),
    }
}

fn failed<E: std::fmt::Display>(cause: &'static str) -> impl FnOnce(E) -> Failure {
    move |error| Failure::new(cause, error.to_string())
}

async fn run(udid: &str, stop: impl Future<Output = ()>) -> Result<(), Exit> {
    tokio::pin!(stop);
    let starting = async {
        let connection = connect(udid, Some(Duration::from_secs(20))).await;
        let Tunnel { mut handshake, mut adapter } = connection.map_err(connection_failure)?;
        let client_connection = RemoteServerClient::connect_rsd(&mut adapter, &mut handshake).await;
        let client = client_connection.map_err(failed("service_open_failed"))?;
        Ok::<_, Failure>(client)
    };
    let mut client = tokio::select! {
        _ = &mut stop => return Err(Exit::Stop),
        client = starting => client?,
    };
    let opening = client.make_channel(SERVICE);
    let channel_timeout = Duration::from_secs(5);
    let channel_result = tokio::time::timeout(channel_timeout, opening).await;
    let opened = channel_result.map_err(|_| Failure::new("service_open_timeout", "Timed out opening the graphics counters"))?;
    let mut channel = opened.map_err(failed("service_open_failed"))?;
    let interval = AuxValue::Double(1.0);
    let args = vec![interval];
    let sampling_method = Some("startSamplingAtTimeInterval:");
    let sampling_args = Some(args);
    let sampling_result = channel.call_method(sampling_method, sampling_args, true).await;
    sampling_result.map_err(failed("sampling_failed"))?;
    let mut ready = false;
    let result = async {
        loop {
            let sample_timeout = Duration::from_secs(5);
            let incoming = channel.read_message();
            tokio::select! {
                _ = &mut stop => return Ok(()),
                received = tokio::time::timeout(sample_timeout, incoming) => {
                    let reading_result = received.map_err(|_| Failure::new("sample_timeout", "The iPhone stopped sending Display FPS counters"))?;
                    let _timing = mobile_dev_telemetry::Timer::start(mobile_dev_telemetry::Timing::FpsRead);
                    let message = reading_result.map_err(failed("sample_failed"))?;
                    let Some(data) = message.data else { continue; };
                    let Some(value) = fps(&data).map_err(failed("invalid_sample"))? else { continue; };
                    // The immediate sample has no complete sampling interval, so it marks readiness.
                    let record = if ready { json!({ "fps": value }) } else { ready = true; json!({ "type": "ready" }) };
                    emit(&record)?;
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

async fn debugserver(udid: &str, stop: impl Future<Output = ()>) -> Result<(), Exit> {
    tokio::pin!(stop);
    let starting = async {
        let connection = connect(udid, None).await;
        let Tunnel { mut handshake, mut adapter } = connection.map_err(connection_failure)?;
        let opening = DebugProxyClient::connect_rsd(&mut adapter, &mut handshake).await;
        let proxy = opening.map_err(failed("service_open_failed"))?;
        let remote = proxy.into_inner();
        let binding = tokio::net::TcpListener::bind("127.0.0.1:0").await;
        let listener = binding.map_err(failed("listen_failed"))?;
        let address = listener.local_addr().map_err(failed("listen_failed"))?;
        Ok::<_, Failure>((remote, listener, address.port()))
    };
    let (mut remote, listener, port) = tokio::select! {
        _ = &mut stop => return Err(Exit::Stop),
        started = starting => started?,
    };
    emit(&json!({ "type": "ready", "port": port }))?;
    let forwarding = async {
        let accepted = listener.accept().await;
        let (mut local, _) = accepted.map_err(failed("forward_failed"))?;
        let result = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
        result.map_err(failed("forward_failed"))?;
        Ok::<(), Exit>(())
    };
    tokio::select! {
        result = forwarding => result,
        _ = &mut stop => Ok(()),
    }
}

async fn stream(mode: &str, udid: &str) -> Result<(), Exit> {
    let stop = protocol::stop_requested()?;
    match mode {
        "fps" => run(udid, stop).await,
        _ => debugserver(udid, stop).await,
    }
}

fn finish(result: Result<(), Exit>) -> ! {
    let code = match result {
        Ok(()) | Err(Exit::Stop) => 0,
        Err(Exit::Fail(failure)) => {
            let _ = emit(&failure.record());
            eprintln!("{}", failure.message);
            1
        },
    };
    mobile_dev_telemetry::close();
    std::process::exit(code);
}

#[tokio::main]
async fn main() {
    mobile_dev_telemetry::init("ios-fps");
    let mut args = std::env::args();
    args.next();
    let mode = args.next();
    let udid = args.next();
    let (Some(mode), Some(udid)) = (mode, udid) else {
        finish(Err(Failure::new("invalid_arguments", "Expected a mode and a physical iPhone UDID").into()));
    };
    match mode.as_str() {
        "fps" | "debugserver" => finish(stream(&mode, &udid).await),
        "foreground" => {
            // One-shot detection keeps its own stderr diagnostic and plain stdout result.
            let detected = foreground::run(&udid).await;
            mobile_dev_telemetry::close();
            if let Err(failure) = detected {
                failure.report();
                eprintln!("{}", failure.message);
                std::process::exit(1);
            }
        },
        _ => finish(Err(Failure::new("invalid_arguments", USAGE).into())),
    }
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
