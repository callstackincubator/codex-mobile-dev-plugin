use idevice::{ReadWrite, RemoteXpcClient, core_device::hid::{
    UniversalHidServiceClient, build_touchscreen_report,
    TOUCHSCREEN_STATE_CONTACT, TOUCHSCREEN_STATE_RELEASE,
}};
use std::time::{Duration, Instant};

#[cfg_attr(not(test), napi_derive::napi(object))]
#[derive(Clone, Copy, Debug)]
pub struct TouchSample {
    pub phase: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Point { x: u16, y: u16 }

fn normalized(value: f64, size: f64) -> Result<u16, String> {
    if value.is_finite() == false || size.is_finite() == false || size <= 0.0 || size > 10000.0 || value < 0.0 || value > size {
        return Err("Invalid physical iOS touch coordinates.".into());
    }
    let scaled = value / size * f64::from(u16::MAX);
    let rounded = scaled.round();
    Ok(rounded as u16)
}

#[derive(Default)]
struct TouchState { active: Option<Point> }

impl TouchState {
    fn prepare(&self, sample: TouchSample) -> Result<(Point, u8), String> {
        let x = normalized(sample.x, sample.width)?;
        let y = normalized(sample.y, sample.height)?;
        let point = Point { x, y };
        match (self.active, sample.phase) {
            (None, 0) | (Some(_), 1) => Ok((point, TOUCHSCREEN_STATE_CONTACT)),
            (Some(_), 2) => Ok((point, TOUCHSCREEN_STATE_RELEASE)),
            (Some(_), 0) => Err("The physical iOS touch is already down.".into()),
            (None, 1 | 2) => Err("The physical iOS touch must be down first.".into()),
            _ => Err("Invalid physical iOS touch phase.".into()),
        }
    }
}

pub struct TouchClient<R: ReadWrite> {
    hid: UniversalHidServiceClient<R>,
    service_id: u64,
    state: TouchState,
    origin: Instant,
    timestamp: u64,
}

impl<R: ReadWrite> TouchClient<R> {
    pub async fn connect(stream: R) -> Result<Self, String> {
        let result = RemoteXpcClient::new(stream).await;
        let mut remote = result.map_err(|error| error.to_string())?;
        let handshake = remote.do_handshake().await;
        handshake.map_err(|error| error.to_string())?;
        let mut hid = UniversalHidServiceClient::new(remote);
        let result = hid.list_connected_services().await;
        let surfaces = result.map_err(|error| error.to_string())?;
        let mut touchscreens = surfaces.iter().filter(|surface| {
            surface.primary_usage_page == Some(0x0d) && surface.primary_usage == Some(4) && surface.service_id > 0
        });
        let surface = touchscreens.next();
        let touchscreen = surface.ok_or("The iPhone did not register a touchscreen input surface.")?;
        let service_id = touchscreen.service_id;
        if touchscreens.next().is_some() { return Err("The iPhone registered more than one touchscreen input surface.".into()); }
        eprintln!("[mobile-dev:ios-mirror] touch_ready service_id={service_id}");
        Ok(Self { hid, service_id, state: TouchState::default(), origin: Instant::now(), timestamp: 0 })
    }

    async fn write(&mut self, point: Point, state: u8) -> Result<(), String> {
        let elapsed = self.origin.elapsed();
        let nanos = elapsed.as_nanos() as u64;
        self.timestamp = nanos.max(self.timestamp + 1);
        let report = build_touchscreen_report(state, point.x, point.y, Some(self.timestamp));
        if state == TOUCHSCREEN_STATE_CONTACT { self.state.active = Some(point); }
        let send = self.hid.send_report(self.service_id, report);
        let result = tokio::time::timeout(Duration::from_secs(1), send).await;
        let sent = result.map_err(|_| "The physical iOS touch service timed out.".to_string())?;
        sent.map_err(|error| error.to_string())?;
        if state == TOUCHSCREEN_STATE_RELEASE { self.state.active = None; }
        Ok(())
    }

    pub async fn send(&mut self, samples: Vec<TouchSample>) -> Result<(), String> {
        for sample in samples {
            let (point, state) = self.state.prepare(sample)?;
            self.write(point, state).await?;
        }
        Ok(())
    }

    pub async fn release(&mut self) -> Result<(), String> {
        if let Some(point) = self.state.active {
            self.write(point, TOUCHSCREEN_STATE_RELEASE).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(phase: u32, x: f64, y: f64) -> TouchSample {
        TouchSample { phase, x, y, width: 400.0, height: 800.0 }
    }

    #[test]
    fn converts_display_coordinates_to_full_range_hid_coordinates() {
        let state = TouchState::default();
        let middle = sample(0, 200.0, 400.0);
        let result = state.prepare(middle);
        let (point, contact) = result.unwrap();
        assert_eq!(point, Point { x: 32768, y: 32768 });
        assert_eq!(contact, TOUCHSCREEN_STATE_CONTACT);
        let corner = sample(0, 400.0, 800.0);
        let result = state.prepare(corner);
        let (point, _) = result.unwrap();
        assert_eq!(point, Point { x: 65535, y: 65535 });
    }

    #[test]
    fn enforces_one_ordered_contact_and_rejects_invalid_coordinates() {
        let mut state = TouchState::default();
        for phase in [1, 2] {
            let sample = sample(phase, 0.0, 0.0);
            let result = state.prepare(sample);
            assert!(result.is_err());
        }
        state.active = Some(Point { x: 0, y: 0 });
        let down = sample(0, 0.0, 0.0);
        let result = state.prepare(down);
        assert!(result.is_err());
        let up = sample(2, 200.0, 400.0);
        let result = state.prepare(up);
        let (_, release) = result.unwrap();
        assert_eq!(release, TOUCHSCREEN_STATE_RELEASE);
        for x in [401.0, f64::NAN, -1.0] {
            let sample = sample(1, x, 0.0);
            let result = state.prepare(sample);
            assert!(result.is_err());
        }
        let mut invalid = sample(1, 0.0, 0.0);
        invalid.height = 0.0;
        let result = state.prepare(invalid);
        assert!(result.is_err());
    }
}
