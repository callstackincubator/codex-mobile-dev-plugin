use std::{future::Future, time::Duration};
use idevice::{ReadWrite, dvt::{message::AuxValue, remote_server::RemoteServerClient}};
use plist::Value;

const SERVICE: &str = "com.apple.accessibility.axAuditDaemon.remoteserver.shim.remote";
type Client = RemoteServerClient<Box<dyn ReadWrite>>;

#[derive(Debug, PartialEq)]
pub struct ForegroundFailure {
    pub cause: &'static str,
    pub message: String,
}

impl ForegroundFailure {
    fn new(cause: &'static str, message: impl Into<String>) -> Self {
        let message = message.into();
        Self { cause, message }
    }

    pub fn report(&self) {
        let diagnostic = serde_json::json!({ "version": 1, "cause": self.cause });
        eprintln!("mobile-dev-foreground-error:{diagnostic}");
    }
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a Value, String> {
    let dictionary = value.as_dictionary();
    let dictionary = dictionary.ok_or("Invalid iPhone accessibility element")?;
    let field = dictionary.get(name);
    let field = field.ok_or("Incomplete iPhone accessibility element")?;
    Ok(field)
}

fn element_pid(value: Option<&Value>) -> Result<Option<u32>, String> {
    let Some(value) = value else { return Ok(None); };
    let dictionary = value.as_dictionary();
    let dictionary = dictionary.ok_or("Invalid iPhone accessibility reply")?;
    // NSKeyedArchive decodes a nil object as an empty dictionary.
    if dictionary.is_empty() { return Ok(None); }
    let object_type = field(value, "ObjectType")?;
    if object_type.as_string() != Some("AXAuditElement_v1") {
        return Err("Unsupported iPhone accessibility element".into());
    }
    let wrapper = field(value, "Value")?;
    let element = field(wrapper, "Value")?;
    let platform = field(element, "PlatformElementValue_v1")?;
    let token = field(platform, "Value")?;
    let bytes = token.as_data();
    let bytes = bytes.ok_or("Invalid iPhone accessibility token")?;
    if bytes.len() != 20 { return Err("Unsupported iPhone accessibility token length".into()); }
    // The physical-device AX token starts with its owning process's little-endian PID.
    let pid_bytes = [bytes[0], bytes[1], bytes[2], bytes[3]];
    let pid = u32::from_le_bytes(pid_bytes);
    if pid == 0 || pid > i32::MAX as u32 { return Err("Invalid foreground iPhone process ID".into()); }
    let result = Some(pid);
    Ok(result)
}

async fn send(client: &mut Client, selector: &str, values: Vec<Value>, reply: bool) -> Result<(), String> {
    let values = values.into_iter();
    let archived = values.map(AuxValue::archived_value);
    let arguments = archived.collect();
    let result = client.call_method(0, Some(selector), Some(arguments), reply).await;
    result.map_err(|error| error.to_string())
}

async fn cleanup(client: &mut Client) -> Result<(), String> {
    let mut failure = None;
    let commands = [
        ("deviceInspectorEnable:", vec![Value::Boolean(false)]),
        ("deviceSetAppMonitoringEnabled:", vec![Value::Boolean(false)]),
        ("devicePerformFinalCleanup", vec![]),
    ];
    for (selector, arguments) in commands {
        let result = send(client, selector, arguments, false).await;
        if let Err(error) = result { failure.get_or_insert(error); }
    }
    let delay = Duration::from_millis(100);
    tokio::time::sleep(delay).await;
    match failure { Some(error) => Err(error), None => Ok(()) }
}

async fn query(client: &mut Client) -> Result<Option<u32>, ForegroundFailure> {
    let mut capabilities = plist::Dictionary::new();
    let connection = "com.apple.private.DTXConnection".into();
    let connection_version = Value::from(1u64);
    capabilities.insert(connection, connection_version);
    let compression = "com.apple.private.DTXBlockCompression".into();
    let compression_version = Value::from(2u64);
    capabilities.insert(compression, compression_version);
    let capabilities = Value::Dictionary(capabilities);
    let published = send(client, "_notifyOfPublishedCapabilities:", vec![capabilities], false).await;
    published.map_err(|message| ForegroundFailure::new("query_failed", message))?;
    let cleaned = cleanup(client).await;
    cleaned.map_err(|message| ForegroundFailure::new("cleanup_failed", message))?;
    let commands = [
        ("deviceInspectorEnable:", Value::Boolean(true)),
        ("deviceSetAppMonitoringEnabled:", Value::Boolean(true)),
        ("deviceInspectorShowVisuals:", Value::Boolean(false)),
        ("deviceInspectorSetMonitoredEventType:", Value::from(0u64)),
    ];
    for (selector, argument) in commands {
        let configured = send(client, selector, vec![argument], false).await;
        configured.map_err(|message| ForegroundFailure::new("query_failed", message))?;
    }
    let root = Value::from(0u64);
    let requested = send(client, "deviceFetchSpecialElement:", vec![root], true).await;
    requested.map_err(|message| ForegroundFailure::new("query_failed", message))?;
    loop {
        let received = client.read_message(0).await;
        let message = received.map_err(|error| {
            let message = error.to_string();
            ForegroundFailure::new("query_failed", message)
        })?;
        // This session has one request expecting a reply; unsolicited app events have index zero.
        let header = message.message_header.serialize();
        let index_bytes = [header[20], header[21], header[22], header[23]];
        let conversation = u32::from_le_bytes(index_bytes);
        if conversation != 1 { continue; }
        let data = message.data.as_ref();
        let pid = element_pid(data);
        return pid.map_err(|message| ForegroundFailure::new("invalid_response", message));
    }
}

async fn inspect(client: &mut Client, cancellation: impl Future<Output = ()>, timeout: Duration) -> Result<Option<u32>, ForegroundFailure> {
    let operation = query(client);
    let result = tokio::select! {
        received = tokio::time::timeout(timeout, operation) => {
            match received {
                Ok(result) => result,
                Err(_) => Err(ForegroundFailure::new("query_timeout", "Timed out detecting the foreground iPhone app")),
            }
        },
        _ = cancellation => Err(ForegroundFailure::new("cancelled", "iPhone app detection cancelled")),
    };
    let finishing = cleanup(client);
    let cleanup_timeout = Duration::from_secs(2);
    let finished = tokio::time::timeout(cleanup_timeout, finishing).await;
    let pid = result?;
    let cleaned = finished.map_err(|_| ForegroundFailure::new("cleanup_timeout", "Timed out closing iPhone app detection"))?;
    cleaned.map_err(|message| ForegroundFailure::new("cleanup_failed", message))?;
    Ok(pid)
}

pub async fn run(udid: &str) -> Result<(), ForegroundFailure> {
    let signal_kind = tokio::signal::unix::SignalKind::terminate();
    let signal = tokio::signal::unix::signal(signal_kind);
    let mut termination = signal.map_err(|error| {
        let message = error.to_string();
        ForegroundFailure::new("query_failed", message)
    })?;
    let connecting = crate::connect(udid);
    let connection_timeout = Duration::from_secs(7);
    let connection = tokio::time::timeout(connection_timeout, connecting).await;
    let connected = connection.map_err(|_| ForegroundFailure::new("connection_timeout", "Timed out connecting to the iPhone for app detection"))?;
    let (handshake, mut adapter) = connected.map_err(|message| {
        let unavailable = message.starts_with("Connect the paired iPhone and enable Developer Mode.");
        let cause = if unavailable { "device_not_found" } else { "connection_failed" };
        ForegroundFailure::new(cause, message)
    })?;
    let service = handshake.services.get(SERVICE);
    let service = service.ok_or_else(|| ForegroundFailure::new("unsupported_service", "The iPhone does not expose foreground app detection"))?;
    let opening = async {
        let connected = adapter.connect(service.port).await;
        let stream = connected.map_err(|error| error.to_string())?;
        let socket: Box<dyn ReadWrite> = Box::new(stream);
        let mut service = idevice::Idevice::new(socket, "mobile-dev-foreground");
        let checkin = service.rsd_checkin().await;
        checkin.map_err(|error| error.to_string())?;
        let stream = service.get_socket();
        let stream = stream.ok_or("Missing iPhone accessibility connection")?;
        let client = RemoteServerClient::new(stream);
        Ok::<Client, String>(client)
    };
    let opening_timeout = Duration::from_secs(3);
    let opened = tokio::time::timeout(opening_timeout, opening).await;
    let opened = opened.map_err(|_| ForegroundFailure::new("service_open_timeout", "Timed out opening iPhone app detection"))?;
    let mut client = opened.map_err(|message| ForegroundFailure::new("service_open_failed", message))?;
    let cancellation = async {
        termination.recv().await;
    };
    let query_timeout = Duration::from_secs(3);
    let pid = inspect(&mut client, cancellation, query_timeout).await?;
    let line = serde_json::json!({ "pid": pid });
    println!("{line}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use idevice::dvt::message::{Message, MessageHeader, PayloadHeader};
    use tokio::io::AsyncWriteExt;

    fn element(bytes: Vec<u8>) -> Value {
        let token = Value::Data(bytes);
        let mut platform = plist::Dictionary::new();
        platform.insert("Value".into(), token);
        let platform = Value::Dictionary(platform);
        let mut element = plist::Dictionary::new();
        element.insert("PlatformElementValue_v1".into(), platform);
        let element = Value::Dictionary(element);
        let mut wrapper = plist::Dictionary::new();
        wrapper.insert("Value".into(), element);
        let wrapper = Value::Dictionary(wrapper);
        let mut result = plist::Dictionary::new();
        result.insert("ObjectType".into(), Value::String("AXAuditElement_v1".into()));
        result.insert("Value".into(), wrapper);
        Value::Dictionary(result)
    }

    #[test]
    fn physical_tokens_identify_nitro_and_mail() {
        let captures = [
            (23931, vec![123, 93, 0, 0, 192, 79, 216, 17, 1, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0]),
            (22067, vec![51, 86, 0, 0, 0, 240, 196, 133, 124, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0]),
        ];
        for (pid, bytes) in captures {
            let value = element(bytes);
            let result = element_pid(Some(&value));
            assert_eq!(result, Ok(Some(pid)));
        }
    }

    #[test]
    fn no_element_is_not_a_process() {
        let absent = element_pid(None);
        assert_eq!(absent, Ok(None));
        let dictionary = plist::Dictionary::new();
        let nil = Value::Dictionary(dictionary);
        let decoded = element_pid(Some(&nil));
        assert_eq!(decoded, Ok(None));
    }

    #[test]
    fn unknown_tokens_and_invalid_pids_are_rejected() {
        let invalid = [vec![123, 93, 0, 0], vec![0; 20], vec![255; 20]];
        for bytes in invalid {
            let value = element(bytes);
            let result = element_pid(Some(&value));
            assert!(result.is_err());
        }
        let event = Value::String("hostAppStateChanged:".into());
        let result = element_pid(Some(&event));
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn query_ignores_events_and_cleans_up_after_nil_errors_timeout_and_cancellation() {
        for scenario in 0..5 {
            let (local, mut remote) = tokio::io::duplex(16384);
            let socket: Box<dyn ReadWrite> = Box::new(local);
            let mut client = RemoteServerClient::new(socket);
            let (ready, started) = tokio::sync::oneshot::channel();
            let device = tokio::spawn(async move {
                let mut commands = Vec::new();
                let query_header = loop {
                    let message = Message::from_reader(&mut remote).await.unwrap();
                    let selector = message.data.unwrap();
                    let name = selector.as_string().unwrap().to_string();
                    commands.push(name.clone());
                    if name == "deviceFetchSpecialElement:" { break message.message_header.serialize(); }
                };
                ready.send(()).unwrap();
                let event_header = MessageHeader::new(0, 1, 500, 0, 0, false);
                let payload = PayloadHeader::new();
                let event = Value::String("hostAppStateChanged:".into());
                let event = Message::new(event_header, payload, None, Some(event));
                let bytes = event.serialize();
                remote.write_all(&bytes).await.unwrap();
                if scenario < 3 {
                    let identifier_bytes = [query_header[16], query_header[17], query_header[18], query_header[19]];
                    let identifier = u32::from_le_bytes(identifier_bytes);
                    let header = MessageHeader::new(0, 1, identifier, 1, 0, false);
                    let payload = PayloadHeader::new();
                    let data = match scenario {
                        0 => {
                            let mut bytes = vec![0; 20];
                            let pid = 23931u32.to_le_bytes();
                            bytes[..4].copy_from_slice(&pid);
                            Some(element(bytes))
                        },
                        1 => None,
                        _ => Some(Value::String("Unsupported reply".into())),
                    };
                    let reply = Message::new(header, payload, None, data);
                    let bytes = reply.serialize();
                    remote.write_all(&bytes).await.unwrap();
                }
                for _ in 0..3 {
                    let message = Message::from_reader(&mut remote).await.unwrap();
                    let selector = message.data.unwrap();
                    let name = selector.as_string().unwrap().to_string();
                    commands.push(name);
                }
                commands
            });
            let cancellation = async {
                if scenario == 4 { started.await.unwrap(); }
                else { std::future::pending::<()>().await; }
            };
            let result = inspect(&mut client, cancellation, Duration::from_millis(300)).await;
            match scenario {
                0 => assert_eq!(result, Ok(Some(23931))),
                1 => assert_eq!(result, Ok(None)),
                3 => assert_eq!(result, Err(ForegroundFailure::new("query_timeout", "Timed out detecting the foreground iPhone app"))),
                4 => assert_eq!(result, Err(ForegroundFailure::new("cancelled", "iPhone app detection cancelled"))),
                _ => {
                    let failure = result.unwrap_err();
                    assert_eq!(failure.cause, "invalid_response");
                },
            }
            let commands = device.await.unwrap();
            let cleanup = &commands[commands.len() - 3..];
            assert_eq!(cleanup, ["deviceInspectorEnable:", "deviceSetAppMonitoringEnabled:", "devicePerformFinalCleanup"]);
        }
    }
}
