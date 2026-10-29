//! One physical iPhone display capture: developer tunnel and display-service
//! setup, the command/feedback/datagram loop, and an orderly stop.

use std::{future::Future, sync::Mutex, time::{Duration, Instant}};

use idevice::{core_device::{build_start_audio_parameters, build_start_video_parameters}, rsd::RsdHandshake,
    tcp::{adapter::UdpDatagram, handle::{AdapterHandle, StreamHandle, UdpSocketHandle}}};
use mobile_dev_device_tunnel::{Tunnel, TunnelError};
use tokio::sync::{Notify, mpsc, oneshot};
use uuid::Uuid;

use crate::{codec, control::{self, Control}, input::{TouchClient, TouchSample}, queue::{Frame, Queue}, recovery::KeyframeRecovery};
use crate::media::{hevc::{HevcAccessUnit, HevcAccessUnitAssembler, HevcDepacketizerEvent, HevcDiscontinuity},
    negotiation::{CallInfoBlob, ScreenVideoStream, build_screen_audio_offer, build_screen_video_offer, parse_screen_video_answer}, rtcp, rtp::RtpPacket};

const SETUP_TIMEOUT: &str = "Timed out opening the iPhone developer connection.";
const SETUP_DEADLINE: Duration = Duration::from_secs(25);
const FEEDBACK_INTERVAL: Duration = Duration::from_millis(500);

pub struct Shared {
    pub queue: Mutex<Queue>,
    pub changed: Notify,
    pub stopped: Notify,
}

pub enum Command {
    RequestKeyframe,
    Close,
    Touch { samples: Vec<TouchSample>, generation: u32, reply: oneshot::Sender<Result<(), String>> },
}

pub type Started = Option<oneshot::Sender<Result<(), String>>>;

async fn setup<T, E: std::fmt::Display>(deadline: tokio::time::Instant, operation: impl Future<Output = Result<T, E>>) -> Result<T, String> {
    let result = tokio::time::timeout_at(deadline, operation).await;
    result.map_err(|_| SETUP_TIMEOUT.to_string())?.map_err(|error| error.to_string())
}

fn connection_id(response: &plist::Value) -> Result<u64, String> {
    response.as_dictionary().and_then(|d| d.get("connection")).and_then(plist::Value::as_dictionary)
        .and_then(|d| d.get("streamConfig")).and_then(plist::Value::as_dictionary)
        .and_then(|d| d.get("RemoteSSRC")).and_then(plist::Value::as_unsigned_integer)
        .filter(|id| *id > 0 && *id <= u64::from(u32::MAX))
        .ok_or_else(|| "The device returned no stream identity.".into())
}

/// Runs a capture until a close command or failure, signalling `started` once
/// frames can flow.
pub async fn run(udid: &str, shared: &Shared, mut commands: mpsc::UnboundedReceiver<Command>, started: &mut Started) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + SETUP_DEADLINE;
    let tunnel = mobile_dev_device_tunnel::open(udid, "mobile-dev", Some(deadline)).await.map_err(|error| match error {
        TunnelError::DeviceNotFound => "The iPhone is no longer connected. Check USB or Wi-Fi pairing in Xcode.".to_string(),
        TunnelError::Timeout => SETUP_TIMEOUT.to_string(),
        TunnelError::SoftwareTunnel(error) => format!("Could not create the developer tunnel: {error}"),
        error => error.to_string(),
    })?;
    let Tunnel { handshake, mut adapter } = tunnel;
    let result = async {
        let mut session = open_session(shared, &handshake, &mut adapter, deadline).await?;
        if let Some(started) = started.take() { let _ = started.send(Ok(())); }
        let streamed = session.stream(&mut commands).await;
        let stopped = session.display.stop().await;
        streamed.and(stopped)
    }.await;
    let _ = adapter.close().await;
    result
}

/// Device-side state that needs an orderly stop: started media streams and a held touch.
struct Display {
    control: Control<StreamHandle>,
    ids: Vec<u64>,
    touch: Option<TouchClient<StreamHandle>>,
}

impl Display {
    async fn release_touch(&mut self) -> Result<(), String> {
        if let Some(touch) = self.touch.as_mut() { touch.release().await?; }
        Ok(())
    }

    /// Releases a held touch and stops the media streams, each within two seconds.
    async fn stop(&mut self) -> Result<(), String> {
        if let Some(touch) = self.touch.as_mut() {
            let released = tokio::time::timeout(Duration::from_secs(2), touch.release()).await;
            if !matches!(released, Ok(Ok(()))) {
                eprintln!("[mobile-dev:ios-mirror] touch_release_failed");
            }
        }
        let stop = tokio::time::timeout(Duration::from_secs(2), self.control.stop(&self.ids)).await;
        stop.map_err(|_| "Timed out stopping the physical display stream.".to_string())?
    }
}

async fn open_session<'a>(shared: &'a Shared, handshake: &RsdHandshake, adapter: &mut AdapterHandle, deadline: tokio::time::Instant) -> Result<Session<'a>, String> {
    let port = handshake.services.get("com.apple.coredevice.displayservice").ok_or("The iPhone does not expose its display service. Enable Developer Mode.")?.port;
    let stream = setup(deadline, adapter.connect(port)).await?;
    let control = setup(deadline, Control::new(stream)).await?;
    let audio = setup(deadline, adapter.bind_udp(0)).await?;
    let video = setup(deadline, adapter.bind_udp(0)).await?;
    let mut display = Display { control, ids: Vec::with_capacity(2), touch: None };
    let our_ssrc = Uuid::new_v4().as_u128() as u32;
    let negotiated = negotiate(&mut display, handshake, adapter, &audio, &video, our_ssrc, deadline).await;
    match negotiated {
        Ok((media, feedback_port)) => Ok(Session::new(shared, display, audio, video, our_ssrc, media, feedback_port)),
        Err(error) => {
            // Streams started before the failure still need stopping; the failure wins.
            let _ = display.stop().await;
            Err(error)
        },
    }
}

/// Starts the audio and video media streams and connects touch input.
async fn negotiate(display: &mut Display, handshake: &RsdHandshake, adapter: &mut AdapterHandle, audio: &UdpSocketHandle, video: &UdpSocketHandle,
    our_ssrc: u32, deadline: tokio::time::Instant) -> Result<(ScreenVideoStream, u16), String> {
    let receiver_ip = adapter.host_ip().to_string();
    let sender_ip = adapter.peer_ip().to_string();
    let session = Uuid::new_v4();
    let call_info = CallInfoBlob { call_id: 0, client_version: 1, device_type: "Mac17,7".into(), framework_version: "2205.3.1".into(), os_version: "25F71".into(), device_name: None, audio_device_uid: None };
    let call_id = Uuid::new_v4().to_string().to_uppercase();
    let offer = build_screen_audio_offer(&call_id, &call_info).map_err(|e| e.to_string())?;
    let params = build_start_audio_parameters(&receiver_ip, audio.local_port(), &sender_ip, 50000, offer, 140, session);
    let start = display.control.invoke("com.apple.coredevice.feature.startmediastream", params, None);
    let answer = setup(deadline, start).await?;
    display.ids.push(connection_id(&answer)?);
    let call_id = Uuid::new_v4().to_string().to_uppercase();
    let offer = build_screen_video_offer(&call_id, &call_info, our_ssrc).map_err(|e| e.to_string())?;
    let params = build_start_video_parameters(&receiver_ip, video.local_port(), &sender_ip, 50001, offer, 140, 1, session);
    let start = display.control.invoke("com.apple.coredevice.feature.startmediastream", params, None);
    let answer = setup(deadline, start).await?;
    display.ids.push(connection_id(&answer)?);
    let feedback_port = control::sender_port(&answer)?;
    let answer = answer.as_dictionary().and_then(|d| d.get("negotiatorAnswer")).and_then(plist::Value::as_data).ok_or("No HEVC negotiation answer.")?;
    let media = parse_screen_video_answer(answer).map_err(|e| e.to_string())?;
    let hid_port = handshake.services.get("com.apple.coredevice.hid.universalhidservice")
        .ok_or("The iPhone does not expose its touch-input service. Prepare it with Xcode 27 and enable Developer Mode.")?.port;
    let stream = setup(deadline, adapter.connect(hid_port)).await?;
    display.touch = Some(setup(deadline, TouchClient::connect(stream)).await?);
    eprintln!("[mobile-dev:ios-mirror] capture_started receiver_ssrc={our_ssrc} media_ssrc={} feedback_port={feedback_port}", media.ssrc);
    Ok((media, feedback_port))
}

/// Why the decoder has to restart from a keyframe.
enum Invalidation {
    /// An unparseable RTP datagram. The queue keeps its generation.
    MalformedRtp { bytes: usize },
    /// The assembler dropped an access unit and already reset itself.
    Discontinuity { reason: HevcDiscontinuity, sequence: u16, timestamp: u32 },
    /// The queue overflowed and already moved to a new generation.
    Overflow { queued_frames: usize, queued_bytes: usize, incoming_bytes: usize, generation: u32, dropped: u32 },
}

struct Session<'a> {
    shared: &'a Shared,
    display: Display,
    audio: UdpSocketHandle,
    video: UdpSocketHandle,
    our_ssrc: u32,
    media: ScreenVideoStream,
    feedback_port: u16,
    assembler: HevcAccessUnitAssembler,
    recovery: KeyframeRecovery,
    origin: Instant,
    frame_count: u16,
    highest_sequence: u16,
    video_packets: u64,
    last_video_packet: Instant,
    first_timestamp: Option<u32>,
    configuration_revision: u64,
}

impl<'a> Session<'a> {
    fn new(shared: &'a Shared, display: Display, audio: UdpSocketHandle, video: UdpSocketHandle, our_ssrc: u32, media: ScreenVideoStream, feedback_port: u16) -> Self {
        let assembler = HevcAccessUnitAssembler::new(media.payload_type, media.ssrc);
        let origin = Instant::now();
        Self { shared, display, audio, video, our_ssrc, media, feedback_port, assembler, recovery: KeyframeRecovery::new(origin), origin,
            frame_count: 0, highest_sequence: 0, video_packets: 0, last_video_packet: origin, first_timestamp: None, configuration_revision: 0 }
    }

    async fn stream(&mut self, commands: &mut mpsc::UnboundedReceiver<Command>) -> Result<(), String> {
        let mut interval = tokio::time::interval(FEEDBACK_INTERVAL);
        loop {
            tokio::select! {
                command = commands.recv() => match command {
                    Some(Command::Close) | None => return Ok(()),
                    Some(command) => self.on_command(command).await?,
                },
                _ = interval.tick() => self.on_tick().await?,
                datagram = self.audio.recv() => { datagram.map_err(|e| e.to_string())?; },
                datagram = self.video.recv() => {
                    let datagram = datagram.map_err(|e| e.to_string())?;
                    self.on_video(datagram).await?;
                },
            }
        }
    }

    async fn on_command(&mut self, command: Command) -> Result<(), String> {
        match command {
            Command::Close => Ok(()),
            Command::RequestKeyframe => { self.recovery.request(Instant::now()); Ok(()) },
            Command::Touch { samples, generation, reply } => {
                let available = {
                    let queue = self.shared.queue.lock().unwrap();
                    queue.generation == generation && queue.configuration.is_some() && !queue.closed
                };
                let operation = async {
                    if !available { return Err("Wait for a fresh physical iOS screen before sending input.".to_string()); }
                    let touch = self.display.touch.as_mut().ok_or("Physical iOS touch input is unavailable.")?;
                    touch.send(samples).await
                };
                let result = tokio::time::timeout(Duration::from_secs(2), operation).await;
                let result = result.unwrap_or_else(|_| Err("The physical iOS touch service timed out.".into()));
                let failure = result.as_ref().err().cloned();
                let _ = reply.send(result);
                failure.map_or(Ok(()), Err)
            },
        }
    }

    /// Sends receiver feedback and, while recovering, a paced keyframe request.
    async fn on_tick(&mut self) -> Result<(), String> {
        let our_ssrc = self.our_ssrc;
        let clock = self.origin.elapsed().as_millis() as u16;
        let report = rtcp::build_rctl(our_ssrc, clock, self.frame_count, self.highest_sequence);
        self.video.send_to(self.feedback_port, report).await.map_err(|e| e.to_string())?;
        let now = Instant::now();
        let Some(fir_sequence) = self.recovery.due(now) else { return Ok(()); };
        let feedback = rtcp::build_keyframe_request(our_ssrc, "mobile-dev", self.media.ssrc, &[], fir_sequence);
        self.video.send_to(self.feedback_port, feedback).await.map_err(|e| e.to_string())?;
        let waiting_ms = self.recovery.waiting(now).as_millis();
        let packet_idle_ms = self.last_video_packet.elapsed().as_millis();
        eprintln!("[mobile-dev:ios-mirror] keyframe_requested receiver_ssrc={our_ssrc} feedback_port={} fir_sequence={fir_sequence} waiting_ms={waiting_ms} video_packets={} packet_idle_ms={packet_idle_ms}",
            self.feedback_port, self.video_packets);
        Ok(())
    }

    async fn on_video(&mut self, datagram: UdpDatagram) -> Result<(), String> {
        if rtcp::is_rtcp(&datagram.data) { return Ok(()); }
        let Some(packet) = RtpPacket::parse(&datagram.data) else {
            return self.invalidate(Invalidation::MalformedRtp { bytes: datagram.data.len() }).await;
        };
        if packet.ssrc == self.media.ssrc && packet.payload_type == self.media.payload_type {
            self.highest_sequence = packet.sequence_number;
            self.video_packets = self.video_packets.wrapping_add(1);
            self.last_video_packet = Instant::now();
        }
        // native.frame.process measures depacketization and access-unit assembly only.
        let events = {
            let _timing = mobile_dev_telemetry::Timer::start(mobile_dev_telemetry::Timing::FrameProcess);
            self.assembler.push_packet(&packet)
        };
        for event in events {
            match event {
                HevcDepacketizerEvent::PacketRejected(_) => {},
                HevcDepacketizerEvent::Discontinuity(reason) => {
                    let invalidation = Invalidation::Discontinuity { reason, sequence: packet.sequence_number, timestamp: packet.timestamp };
                    self.invalidate(invalidation).await?;
                },
                HevcDepacketizerEvent::AccessUnit(unit) => self.on_access_unit(unit).await?,
            }
        }
        Ok(())
    }

    async fn on_access_unit(&mut self, unit: HevcAccessUnit) -> Result<(), String> {
        let our_ssrc = self.our_ssrc;
        self.frame_count = self.frame_count.wrapping_add(1);
        let acknowledgment = rtcp::build_frame_ack(our_ssrc, unit.rtp_timestamp);
        self.video.send_to(self.feedback_port, acknowledgment).await.map_err(|e| e.to_string())?;
        let configuration = if unit.parameter_set_revision != self.configuration_revision {
            let parameters = self.assembler.parameter_sets().ok_or("Missing HEVC configuration.")?;
            Some(codec::configuration(parameters)?)
        } else { None };
        if let Some(configuration) = &configuration { self.configuration_revision = configuration.revision; }
        let first = *self.first_timestamp.get_or_insert(unit.rtp_timestamp);
        let timestamp = f64::from(unit.rtp_timestamp.wrapping_sub(first)) * (1_000_000.0 / 90_000.0);
        let frame = Frame { bytes: unit.bytes, timestamp, key: unit.is_sync };
        let incoming_bytes = frame.bytes.len();
        let (accepted, queued_frames, queued_bytes, previous_generation, generation, dropped) = {
            let mut queue = self.shared.queue.lock().unwrap();
            let queued_frames = queue.frames.len();
            let queued_bytes = queue.bytes;
            let previous_generation = queue.generation;
            let accepted = queue.push(frame, configuration);
            (accepted, queued_frames, queued_bytes, previous_generation, queue.generation, queue.dropped)
        };
        if accepted {
            if generation != previous_generation {
                self.display.release_touch().await?;
                eprintln!("[mobile-dev:ios-mirror] configuration_changed receiver_ssrc={our_ssrc} revision={} generation={generation} dropped={dropped} key={}", unit.parameter_set_revision, unit.is_sync);
            }
            if unit.is_sync && let Some(waited) = self.recovery.on_sync(Instant::now()) {
                eprintln!("[mobile-dev:ios-mirror] keyframe_received receiver_ssrc={our_ssrc} timestamp={} generation={generation} dropped={dropped} waiting_ms={}", unit.rtp_timestamp, waited.as_millis());
            }
        } else {
            self.invalidate(Invalidation::Overflow { queued_frames, queued_bytes, incoming_bytes, generation, dropped }).await?;
        }
        self.shared.changed.notify_one();
        Ok(())
    }

    /// Restarts decoding from the next keyframe. A new queue generation also
    /// invalidates the panel's touch, so a held touch is released first.
    async fn invalidate(&mut self, invalidation: Invalidation) -> Result<(), String> {
        if !matches!(invalidation, Invalidation::MalformedRtp { .. }) { self.display.release_touch().await?; }
        if !matches!(invalidation, Invalidation::Discontinuity { .. }) { self.assembler.mark_stream_discontinuity(); }
        let started = self.recovery.request(Instant::now());
        let our_ssrc = self.our_ssrc;
        match invalidation {
            Invalidation::MalformedRtp { bytes } => {
                if started { eprintln!("[mobile-dev:ios-mirror] malformed_rtp receiver_ssrc={our_ssrc} bytes={bytes}"); }
            },
            Invalidation::Discontinuity { reason, sequence, timestamp } => {
                let (generation, dropped) = {
                    let mut queue = self.shared.queue.lock().unwrap();
                    queue.invalidate();
                    (queue.generation, queue.dropped)
                };
                eprintln!("[mobile-dev:ios-mirror] discontinuity receiver_ssrc={our_ssrc} reason={reason:?} sequence={sequence} timestamp={timestamp} generation={generation} dropped={dropped}");
                self.shared.changed.notify_one();
            },
            Invalidation::Overflow { queued_frames, queued_bytes, incoming_bytes, generation, dropped } => {
                eprintln!("[mobile-dev:ios-mirror] queue_overflow receiver_ssrc={our_ssrc} queued_frames={queued_frames} queued_bytes={queued_bytes} incoming_bytes={incoming_bytes} generation={generation} dropped={dropped}");
            },
        }
        Ok(())
    }
}
