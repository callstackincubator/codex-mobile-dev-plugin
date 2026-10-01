use std::ffi::CString;
use std::sync::Once;

unsafe extern "C" {
    fn mobile_dev_telemetry_init(component: *const std::ffi::c_char);
    fn mobile_dev_telemetry_close();
    fn mobile_dev_telemetry_now() -> f64;
    fn mobile_dev_telemetry_timing(kind: std::ffi::c_int, duration: f64);
    fn mobile_dev_telemetry_panic(file: *const std::ffi::c_char, line: u32);
}

static START: Once = Once::new();

pub fn init(component: &str) {
    START.call_once(|| {
        let name = CString::new(component);
        let name = name.expect("Telemetry components are static names.");
        let pointer = name.as_ptr();
        unsafe { mobile_dev_telemetry_init(pointer); }
        let previous = std::panic::take_hook();
        let hook = Box::new(move |panic: &std::panic::PanicHookInfo<'_>| {
            if let Some(location) = panic.location() {
                let source = location.file();
                let path = std::path::Path::new(source);
                let filename = path.file_name();
                let filename = filename.and_then(|name| name.to_str());
                let filename = filename.unwrap_or("rust");
                if let Ok(file) = CString::new(filename) {
                    let pointer = file.as_ptr();
                    let line = location.line();
                    unsafe { mobile_dev_telemetry_panic(pointer, line); }
                }
            }
            previous(panic);
        });
        std::panic::set_hook(hook);
    });
}

#[derive(Clone, Copy)]
#[repr(i32)]
pub enum Timing { Connect, FrameProcess, Input, LogProcess, CpuSample, FpsRead }

pub struct Timer { kind: Timing, started: f64 }

impl Timer {
    pub fn start(kind: Timing) -> Self {
        let started = unsafe { mobile_dev_telemetry_now() };
        Self { kind, started }
    }
}

impl Drop for Timer {
    fn drop(&mut self) {
        let now = unsafe { mobile_dev_telemetry_now() };
        let elapsed = now - self.started;
        unsafe { mobile_dev_telemetry_timing(self.kind as i32, elapsed); }
    }
}

pub fn close() {
    unsafe { mobile_dev_telemetry_close(); }
}
