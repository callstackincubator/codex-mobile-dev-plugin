//! The shared native-helper protocol for the streaming modes: stdout carries one
//! JSON record per line, starting with `{"type":"ready",...}`; a handled failure
//! ends with `{"type":"error","cause":...,"message":...}` and a non-zero exit.
//! EOF on stdin or SIGTERM asks the helper to stop, and so does a closed stdout:
//! the Rust runtime ignores SIGPIPE, so writes report EPIPE instead.

use std::io::{self, Read, Write};
use serde_json::{Value, json};

#[derive(Debug, PartialEq)]
pub struct Failure {
    pub cause: &'static str,
    pub message: String,
}

impl Failure {
    pub fn new(cause: &'static str, message: impl Into<String>) -> Self {
        let message = message.into();
        Self { cause, message }
    }

    pub fn record(&self) -> Value {
        json!({ "type": "error", "cause": self.cause, "message": self.message })
    }
}

#[derive(Debug, PartialEq)]
pub enum Exit {
    /// The reader asked the helper to stop or went away.
    Stop,
    Fail(Failure),
}

impl From<Failure> for Exit {
    fn from(failure: Failure) -> Self { Self::Fail(failure) }
}

pub fn write_record(output: &mut impl Write, record: &Value) -> Result<(), Exit> {
    let written = writeln!(output, "{record}").and_then(|()| output.flush());
    match written {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::BrokenPipe => Err(Exit::Stop),
        Err(error) => Err(Failure::new("output_failed", error.to_string()).into()),
    }
}

pub fn emit(record: &Value) -> Result<(), Exit> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    write_record(&mut output, record)
}

fn wait_for_end_of_input(mut input: impl Read) {
    let mut buffer = [0u8; 256];
    loop {
        match input.read(&mut buffer) {
            Ok(0) => return,
            Ok(_) => continue,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
}

/// Resolves when stdin reaches EOF or SIGTERM arrives. A plain thread reads
/// stdin because a blocked read cannot be cancelled and must not hold up exit.
pub fn stop_requested() -> Result<impl Future<Output = ()>, Failure> {
    let kind = tokio::signal::unix::SignalKind::terminate();
    let signal = tokio::signal::unix::signal(kind);
    let mut termination = signal.map_err(|error| Failure::new("internal", error.to_string()))?;
    let (ended, input_closed) = tokio::sync::oneshot::channel();
    let reader = std::thread::Builder::new().name("stdin".into()).spawn(move || {
        wait_for_end_of_input(io::stdin());
        let _ = ended.send(());
    });
    reader.map_err(|error| Failure::new("internal", error.to_string()))?;
    Ok(async move {
        tokio::select! {
            _ = termination.recv() => {},
            _ = input_closed => {},
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ClosedPipe;

    impl Write for ClosedPipe {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> { Err(io::ErrorKind::BrokenPipe.into()) }
        fn flush(&mut self) -> io::Result<()> { Ok(()) }
    }

    #[test]
    fn records_are_single_json_lines() {
        let mut output = Vec::new();
        write_record(&mut output, &json!({ "type": "ready", "port": 50000 })).unwrap();
        let failure = Failure::new("device_not_found", "Connect the iPhone.\nRetry.");
        write_record(&mut output, &failure.record()).unwrap();
        let text = String::from_utf8(output).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines, [r#"{"port":50000,"type":"ready"}"#, r#"{"cause":"device_not_found","message":"Connect the iPhone.\nRetry.","type":"error"}"#]);
    }

    #[test]
    fn a_closed_reader_stops_instead_of_failing() {
        let result = write_record(&mut ClosedPipe, &json!({ "fps": 60.0 }));
        assert_eq!(result, Err(Exit::Stop));
    }

    #[test]
    fn input_data_does_not_stop_until_end_of_file() {
        let input: &[u8] = b"ignored\nbytes";
        wait_for_end_of_input(input);
    }
}
