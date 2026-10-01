use crate::{codec, control, media, queue::{Queue, Frame}};

use std::{future::Future, sync::{Arc, Mutex}, time::{Duration, Instant}};

async fn setup<T, E: std::fmt::Display>(deadline: tokio::time::Instant, operation: impl Future<Output = std::result::Result<T, E>>) -> std::result::Result<T, String> {
    let result = tokio::time::timeout_at(deadline, operation).await;
    result.map_err(|_| "Timed out opening the iPhone developer connection.".to_string())?.map_err(|error| error.to_string())
}

use idevice::{IdeviceService, core_device::{build_start_audio_parameters, build_start_video_parameters}, core_device_proxy::CoreDeviceProxy, usbmuxd::{Connection, UsbmuxdAddr}, rsd::RsdHandshake};
use media::{hevc::{HevcAccessUnitAssembler, HevcDepacketizerEvent}, negotiation::{CallInfoBlob, build_screen_audio_offer, build_screen_video_offer, parse_screen_video_answer}, rtcp, rtp::RtpPacket};
use napi::{bindgen_prelude::Buffer, Error, Result};
use napi_derive::napi;
use tokio::sync::{Notify, mpsc};
use uuid::Uuid;

struct Shared {
    queue: Mutex<Queue>,
    changed: Notify,
    stopped: Notify,
}

enum Command { Reset, Close }

#[napi(object)]
pub struct VideoConfiguration {
    pub revision: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub description: Buffer,
}

#[napi(object)]
pub struct VideoFrame {
    pub data: Buffer,
    pub timestamp: f64,
    pub key: bool,
}

#[napi(object)]
pub struct VideoBatch {
    pub generation: u32,
    pub frames: Vec<VideoFrame>,
    pub configuration: Option<VideoConfiguration>,
    pub dropped: u32,
}

#[napi]
pub struct Capture {
    shared: Arc<Shared>,
    commands: mpsc::UnboundedSender<Command>,
}

#[napi]
impl Capture {
    #[napi]
    pub async fn read(&self) -> Result<VideoBatch> {
        let wait = self.shared.changed.notified();
        let waiting = {
            let queue = self.shared.queue.lock().unwrap();
            queue.frames.is_empty() && queue.error.is_none() && !queue.closed
        };
        if waiting { let _ = tokio::time::timeout(Duration::from_secs(1), wait).await; }
        let mut queue = self.shared.queue.lock().unwrap();
        if let Some(error) = &queue.error { return Err(Error::from_reason(error.clone())); }
        if queue.closed { return Err(Error::from_reason("The physical device stream closed.")); }
        let configuration = if queue.configuration_pending {
            queue.configuration_pending = false;
            queue.configuration.as_ref().map(|value| VideoConfiguration {
                revision: value.revision as f64, width: value.width, height: value.height,
                codec: value.codec.clone(), description: value.description.clone().into(),
            })
        } else { None };
        let frames = queue.frames.drain(..).map(|frame| VideoFrame {
            data: frame.bytes.into(), timestamp: frame.timestamp, key: frame.key,
        }).collect();
        queue.bytes = 0;
        Ok(VideoBatch { generation: queue.generation, frames, configuration, dropped: queue.dropped })
    }

    #[napi]
    pub fn reset(&self) { let _ = self.commands.send(Command::Reset); }

    #[napi]
    pub async fn close(&self) {
        let stopped = self.shared.stopped.notified();
        let closed = self.shared.queue.lock().unwrap().closed;
        if closed { return; }
        let _ = self.commands.send(Command::Close);
        let _ = tokio::time::timeout(Duration::from_secs(4), stopped).await;
    }
}

impl Drop for Capture {
    fn drop(&mut self) { let _ = self.commands.send(Command::Close); }
}

#[napi]
pub async fn open_device(udid: String) -> Result<Capture> {
    let shared = Arc::new(Shared { queue: Mutex::new(Queue::default()), changed: Notify::new(), stopped: Notify::new() });
    let (sender, receiver) = mpsc::unbounded_channel();
    let (started, ready) = tokio::sync::oneshot::channel();
    let worker_shared = shared.clone();
    tokio::spawn(async move {
        let result = run(&udid, &worker_shared, receiver, started).await;
        if let Err(error) = &result { eprintln!("[mobile-dev:ios-mirror] capture_failed error={error}"); }
        let mut queue = worker_shared.queue.lock().unwrap();
        queue.error = result.err();
        queue.closed = true;
        queue.frames.clear();
        queue.bytes = 0;
        drop(queue);
        worker_shared.changed.notify_waiters();
        worker_shared.stopped.notify_waiters();
    });
    let startup = tokio::time::timeout(Duration::from_secs(30), ready).await;
    match startup {
        Ok(Ok(Ok(()))) => Ok(Capture { shared, commands: sender }),
        Ok(Ok(Err(message))) => Err(Error::from_reason(message)),
        Ok(Err(_)) => {
            let message = shared.queue.lock().unwrap().error.clone().unwrap_or_else(|| "The physical device capture stopped during setup.".into());
            Err(Error::from_reason(message))
        },
        _ => { let _ = sender.send(Command::Close); Err(Error::from_reason("Timed out opening the physical device display.")) }
    }
}

fn connection_id(response: &plist::Value) -> std::result::Result<u64, String> {
    response.as_dictionary().and_then(|d| d.get("connection")).and_then(plist::Value::as_dictionary)
        .and_then(|d| d.get("streamConfig")).and_then(plist::Value::as_dictionary)
        .and_then(|d| d.get("RemoteSSRC")).and_then(plist::Value::as_unsigned_integer)
        .filter(|id| *id > 0 && *id <= u64::from(u32::MAX))
        .ok_or_else(|| "The device returned no stream identity.".into())
}

async fn run(udid: &str, shared: &Shared, mut commands: mpsc::UnboundedReceiver<Command>, started: tokio::sync::oneshot::Sender<std::result::Result<(), String>>) -> std::result::Result<(), String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
    let address = UsbmuxdAddr::UnixSocket("/var/run/usbmuxd".into());
    let connect = address.connect(1);
    let mut mux = setup(deadline, connect).await?;
    let discovery = mux.get_devices();
    let devices = setup(deadline, discovery).await?;
    let device = devices.iter().filter(|device| device.udid == udid).min_by_key(|device| if device.connection_type == Connection::Usb { 0 } else { 1 })
        .ok_or("The iPhone is no longer connected. Check USB or Wi-Fi pairing in Xcode.")?;
    let provider = device.to_provider(address, "mobile-dev");
    let connect = CoreDeviceProxy::connect(&provider);
    let proxy = setup(deadline, connect).await?;
    let rsd_port = proxy.tunnel_info().server_rsd_port;
    let adapter = proxy.create_software_tunnel().map_err(|e| format!("Could not create the developer tunnel: {e}"))?;
    let mut adapter = adapter.to_async_handle();
    let mut ids = Vec::with_capacity(2);
    let result = async {
        let connect = adapter.connect(rsd_port);
        let stream = setup(deadline, connect).await?;
        let discover = RsdHandshake::new(stream);
        let handshake = setup(deadline, discover).await?;
        let port = handshake.services.get("com.apple.coredevice.displayservice").ok_or("The iPhone does not expose its display service. Enable Developer Mode.")?.port;
        let connect = adapter.connect(port);
        let stream = setup(deadline, connect).await?;
        let connect = control::Control::new(stream);
        let mut control = setup(deadline, connect).await?;
        let bind = adapter.bind_udp(0);
        let audio = setup(deadline, bind).await?;
        let bind = adapter.bind_udp(0);
        let video = setup(deadline, bind).await?;
        let receiver_ip = adapter.host_ip().to_string();
        let sender_ip = adapter.peer_ip().to_string();
        let session = Uuid::new_v4();
        let our_ssrc = Uuid::new_v4().as_u128() as u32;
        let call_info = CallInfoBlob { call_id: 0, client_version: 1, device_type: "Mac17,7".into(), framework_version: "2205.3.1".into(), os_version: "25F71".into(), device_name: None, audio_device_uid: None };
        let capture = async {
            let call_id = Uuid::new_v4().to_string().to_uppercase();
            let offer = build_screen_audio_offer(&call_id, &call_info).map_err(|e| e.to_string())?;
            let params = build_start_audio_parameters(&receiver_ip, audio.local_port(), &sender_ip, 50000, offer, 140, session);
            let start = control.invoke("com.apple.coredevice.feature.startmediastream", params, None);
            let answer = setup(deadline, start).await?;
            ids.push(connection_id(&answer)?);
            let call_id = Uuid::new_v4().to_string().to_uppercase();
            let offer = build_screen_video_offer(&call_id, &call_info, our_ssrc).map_err(|e| e.to_string())?;
            let params = build_start_video_parameters(&receiver_ip, video.local_port(), &sender_ip, 50001, offer, 140, 1, session);
            let start = control.invoke("com.apple.coredevice.feature.startmediastream", params, None);
            let answer = setup(deadline, start).await?;
            ids.push(connection_id(&answer)?);
            let feedback_port = control::sender_port(&answer)?;
            let answer = answer.as_dictionary().and_then(|d| d.get("negotiatorAnswer")).and_then(plist::Value::as_data).ok_or("No HEVC negotiation answer.")?;
            let identity = parse_screen_video_answer(answer).map_err(|e| e.to_string())?;
            eprintln!("[mobile-dev:ios-mirror] capture_started receiver_ssrc={our_ssrc} media_ssrc={} feedback_port={feedback_port}", identity.ssrc);
            let mut assembler = HevcAccessUnitAssembler::new(identity.payload_type, identity.ssrc);
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            let mut last_key = Instant::now() - Duration::from_secs(1);
            let mut fir_sequence = 0u8;
            let mut key_requested = true;
            let mut highest_sequence = 0;
            let mut frame_count = 0u16;
            let origin = Instant::now();
            let mut recovery_started = Some(origin);
            let mut video_packets = 0u64;
            let mut last_video_packet = origin;
            let mut first_timestamp = None;
            let mut configuration_revision = 0;
            let _ = started.send(Ok(()));
            loop {
                tokio::select! {
                    command = commands.recv() => match command {
                        Some(Command::Close) | None => return Ok(()),
                        Some(Command::Reset) => {
                            assembler.mark_stream_discontinuity(); key_requested = true;
                            let now = Instant::now();
                            recovery_started = Some(now);
                            let mut queue = shared.queue.lock().unwrap();
                            queue.invalidate();
                            let generation = queue.generation;
                            let dropped = queue.dropped;
                            drop(queue);
                            eprintln!("[mobile-dev:ios-mirror] reset_requested receiver_ssrc={our_ssrc} generation={generation} dropped={dropped}");
                        }
                    },
                    _ = interval.tick() => {
                        let clock = origin.elapsed().as_millis() as u16;
                        let report = rtcp::build_rctl(our_ssrc, clock, frame_count, highest_sequence);
                        video.send_to(feedback_port, report).await.map_err(|e| e.to_string())?;
                        if key_requested && last_key.elapsed() >= Duration::from_secs(1) {
                            let feedback = rtcp::build_keyframe_request(our_ssrc, "mobile-dev", identity.ssrc, &[], fir_sequence);
                            video.send_to(feedback_port, feedback).await.map_err(|e| e.to_string())?;
                            let waiting_ms = recovery_started.map(|started| {
                                let elapsed = started.elapsed();
                                elapsed.as_millis()
                            });
                            let waiting_ms = waiting_ms.unwrap_or(0);
                            let packet_idle = last_video_packet.elapsed();
                            let packet_idle_ms = packet_idle.as_millis();
                            eprintln!("[mobile-dev:ios-mirror] keyframe_requested receiver_ssrc={our_ssrc} feedback_port={feedback_port} fir_sequence={fir_sequence} waiting_ms={waiting_ms} video_packets={video_packets} packet_idle_ms={packet_idle_ms}");
                            fir_sequence = fir_sequence.wrapping_add(1); last_key = Instant::now();
                        }
                    },
                    datagram = audio.recv() => { datagram.map_err(|e| e.to_string())?; },
                    datagram = video.recv() => {
                        let datagram = datagram.map_err(|e| e.to_string())?;
                        if rtcp::is_rtcp(&datagram.data) { continue; }
                        let Some(packet) = RtpPacket::parse(&datagram.data) else {
                            if key_requested == false {
                                let now = Instant::now();
                                recovery_started = Some(now);
                                eprintln!("[mobile-dev:ios-mirror] malformed_rtp receiver_ssrc={our_ssrc} bytes={}", datagram.data.len());
                            }
                            assembler.mark_stream_discontinuity(); key_requested = true;
                            continue;
                        };
                        if packet.ssrc == identity.ssrc && packet.payload_type == identity.payload_type {
                            highest_sequence = packet.sequence_number;
                            video_packets = video_packets.wrapping_add(1);
                            last_video_packet = Instant::now();
                        }
                        for event in assembler.push_packet(&packet) {
                            match event {
                                HevcDepacketizerEvent::PacketRejected(_) => {},
                                HevcDepacketizerEvent::Discontinuity(reason) => {
                                    if key_requested == false {
                                        let now = Instant::now();
                                        recovery_started = Some(now);
                                    }
                                    key_requested = true;
                                    let mut queue = shared.queue.lock().unwrap();
                                    queue.invalidate();
                                    let generation = queue.generation;
                                    let dropped = queue.dropped;
                                    drop(queue);
                                    eprintln!("[mobile-dev:ios-mirror] discontinuity receiver_ssrc={our_ssrc} reason={reason:?} sequence={} timestamp={} generation={generation} dropped={dropped}", packet.sequence_number, packet.timestamp);
                                    shared.changed.notify_one();
                                },
                                HevcDepacketizerEvent::AccessUnit(unit) => {
                                    frame_count = frame_count.wrapping_add(1);
                                    let acknowledgment = rtcp::build_frame_ack(our_ssrc, unit.rtp_timestamp);
                                    video.send_to(feedback_port, acknowledgment).await.map_err(|e| e.to_string())?;
                                    let configuration = if unit.parameter_set_revision != configuration_revision {
                                        let parameters = assembler.parameter_sets().ok_or("Missing HEVC configuration.")?;
                                        Some(codec::configuration(parameters)?)
                                    } else { None };
                                    let mut queue = shared.queue.lock().unwrap();
                                    if let Some(configuration) = &configuration { configuration_revision = configuration.revision; }
                                    let first = *first_timestamp.get_or_insert(unit.rtp_timestamp);
                                    let timestamp = f64::from(unit.rtp_timestamp.wrapping_sub(first)) * (1_000_000.0 / 90_000.0);
                                    let frame = Frame { bytes: unit.bytes, timestamp, key: unit.is_sync };
                                    let queued_frames = queue.frames.len();
                                    let queued_bytes = queue.bytes;
                                    let previous_generation = queue.generation;
                                    let incoming_bytes = frame.bytes.len();
                                    let accepted = queue.push(frame, configuration);
                                    let generation = queue.generation;
                                    let dropped = queue.dropped;
                                    drop(queue);
                                    if accepted {
                                        if generation != previous_generation {
                                            eprintln!("[mobile-dev:ios-mirror] configuration_changed receiver_ssrc={our_ssrc} revision={} generation={generation} dropped={dropped} key={}", unit.parameter_set_revision, unit.is_sync);
                                        }
                                        if unit.is_sync {
                                            key_requested = false;
                                            if let Some(started) = recovery_started.take() {
                                                let elapsed = started.elapsed();
                                                let waiting_ms = elapsed.as_millis();
                                                eprintln!("[mobile-dev:ios-mirror] keyframe_received receiver_ssrc={our_ssrc} timestamp={} generation={generation} dropped={dropped} waiting_ms={waiting_ms}", unit.rtp_timestamp);
                                            }
                                        }
                                    } else {
                                        assembler.mark_stream_discontinuity(); key_requested = true;
                                        if recovery_started.is_none() {
                                            let now = Instant::now();
                                            recovery_started = Some(now);
                                        }
                                        eprintln!("[mobile-dev:ios-mirror] queue_overflow receiver_ssrc={our_ssrc} queued_frames={queued_frames} queued_bytes={queued_bytes} incoming_bytes={incoming_bytes} generation={generation} dropped={dropped}");
                                    }
                                    shared.changed.notify_one();
                                }
                            }
                        }
                    }
                }
            }
        }.await;
        let stop = tokio::time::timeout(Duration::from_secs(2), control.stop(&ids)).await;
        if capture.is_ok() { stop.map_err(|_| "Timed out stopping the physical display stream.".to_string())??; }
        capture
    }.await;
    let _ = adapter.close().await;
    result
}
