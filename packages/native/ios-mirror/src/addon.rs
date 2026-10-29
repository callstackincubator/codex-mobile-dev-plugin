use crate::{input::TouchSample, queue::Queue, session::{self, Command, Shared}};

use std::{sync::{Arc, Mutex}, time::Duration};

use napi::{bindgen_prelude::Buffer, Error, Result};
use napi_derive::napi;
use tokio::sync::{Notify, mpsc};

#[napi_derive::module_init]
pub fn initialize_telemetry() {
    mobile_dev_telemetry::init("ios-mirror");
}

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
    pub fn request_keyframe(&self) { let _ = self.commands.send(Command::RequestKeyframe); }

    #[napi]
    pub async fn touch(&self, samples: Vec<TouchSample>, generation: u32) -> Result<()> {
        let _timing = mobile_dev_telemetry::Timer::start(mobile_dev_telemetry::Timing::Input);
        if samples.is_empty() || samples.len() > 64 { return Err(Error::from_reason("Send between one and 64 physical iOS touch samples.")); }
        let (reply, received) = tokio::sync::oneshot::channel();
        let command = Command::Touch { samples, generation, reply };
        self.commands.send(command).map_err(|_| Error::from_reason("The physical iOS input session closed."))?;
        let result = tokio::time::timeout(Duration::from_secs(4), received).await;
        let response = result.map_err(|_| Error::from_reason("The physical iOS input timed out."))?;
        let delivered = response.map_err(|_| Error::from_reason("The physical iOS input session closed."))?;
        delivered.map_err(Error::from_reason)
    }

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
    let _timing = mobile_dev_telemetry::Timer::start(mobile_dev_telemetry::Timing::Connect);
    let shared = Arc::new(Shared { queue: Mutex::new(Queue::default()), changed: Notify::new(), stopped: Notify::new() });
    let (sender, receiver) = mpsc::unbounded_channel();
    let (started, ready) = tokio::sync::oneshot::channel();
    let worker_shared = shared.clone();
    tokio::spawn(async move {
        let mut started = Some(started);
        let result = session::run(&udid, &worker_shared, receiver, &mut started).await;
        if let Err(error) = &result {
            if let Some(started) = started {
                let message = error.clone();
                let response = Err(message);
                let _ = started.send(response);
            }
            eprintln!("[mobile-dev:ios-mirror] capture_failed error={error}");
        }
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
            let error = Error::from_reason("The physical device capture worker stopped during setup.");
            Err(error)
        },
        _ => { let _ = sender.send(Command::Close); Err(Error::from_reason("Timed out opening the physical device display.")) }
    }
}
