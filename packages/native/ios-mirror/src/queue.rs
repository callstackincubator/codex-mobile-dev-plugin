use std::collections::VecDeque;
use crate::codec::Configuration;

pub const MAX_FRAMES: usize = 8;
pub const MAX_BYTES: usize = 4 * 1024 * 1024;

pub struct Frame {
    pub bytes: Vec<u8>,
    pub timestamp: f64,
    pub key: bool,
}

#[derive(Default)]
pub struct Queue {
    pub frames: VecDeque<Frame>,
    pub bytes: usize,
    pub generation: u32,
    pub configuration: Option<Configuration>,
    pub configuration_pending: bool,
    pub error: Option<String>,
    pub closed: bool,
    pub dropped: u32,
}

impl Queue {
    pub fn invalidate(&mut self) {
        self.dropped = self.dropped.saturating_add(self.frames.len() as u32);
        self.frames.clear();
        self.bytes = 0;
        self.generation = self.generation.wrapping_add(1);
        self.configuration_pending = true;
    }

    pub fn push(&mut self, frame: Frame, configuration: Option<Configuration>) -> bool {
        if let Some(configuration) = configuration {
            if self.configuration.is_some() { self.invalidate(); }
            self.configuration = Some(configuration);
            self.configuration_pending = true;
        }
        if self.frames.len() >= MAX_FRAMES || self.bytes + frame.bytes.len() > MAX_BYTES {
            self.invalidate();
            self.dropped = self.dropped.saturating_add(1);
            return false;
        }
        self.bytes += frame.bytes.len();
        self.frames.push_back(frame);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(length: usize) -> Frame { Frame { bytes: vec![7; length], timestamp: 0.0, key: true } }
    fn configuration(revision: u64) -> Configuration { Configuration { revision, width: 1216, height: 2656, codec: "hvc1.1.6.L150.B0".into(), description: vec![1] } }

    #[test]
    fn moves_the_compressed_allocation_without_copying_it() {
        let frame = frame(512);
        let allocation = frame.bytes.as_ptr();
        let mut queue = Queue::default();
        assert!(queue.push(frame, None));
        let output = queue.frames.pop_front().unwrap();
        assert_eq!(allocation, output.bytes.as_ptr());
    }

    #[test]
    fn overflow_drops_backlog_and_advances_the_decoder_generation() {
        let mut queue = Queue::default();
        for _ in 0..MAX_FRAMES { assert!(queue.push(frame(10), None)); }
        assert!(!queue.push(frame(10), None));
        assert!(queue.frames.is_empty());
        assert_eq!(queue.bytes, 0);
        assert_eq!(queue.generation, 1);
        assert_eq!(queue.dropped, 9);
    }

    #[test]
    fn oversized_access_units_do_not_enter_the_queue() {
        let mut queue = Queue::default();
        assert!(!queue.push(frame(MAX_BYTES + 1), None));
        assert_eq!(queue.bytes, 0);
        assert_eq!(queue.frames.len(), 0);
    }

    #[test]
    fn a_new_configuration_cannot_be_applied_to_old_frames() {
        let mut queue = Queue::default();
        assert!(queue.push(frame(10), Some(configuration(1))));
        assert!(queue.push(frame(20), Some(configuration(2))));
        assert_eq!(queue.frames.len(), 1);
        assert_eq!(queue.bytes, 20);
        assert_eq!(queue.generation, 1);
        assert_eq!(queue.configuration.unwrap().revision, 2);
    }
}
