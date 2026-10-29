use std::time::{Duration, Instant};

/// Repeats intra-refresh requests (RTCP FIR) about once a second until a sync
/// sample arrives, and measures how long each recovery waited.
///
/// A recovery is pending exactly while `started` is set: every request starts
/// one unless one is already pending, and the accepted sync sample ends it. The
/// capture loop used to track this with a separate `key_requested` flag, and its
/// call sites guarded either on that flag or on `started.is_none()`; both always
/// agreed, so one field replaces them without changing when requests are sent.
#[derive(Debug)]
pub struct KeyframeRecovery {
    started: Option<Instant>,
    last_request: Instant,
    fir_sequence: u8,
}

const REQUEST_INTERVAL: Duration = Duration::from_secs(1);

impl KeyframeRecovery {
    /// A new stream starts waiting for its first keyframe, due immediately.
    pub fn new(now: Instant) -> Self {
        let last_request = now.checked_sub(REQUEST_INTERVAL).unwrap_or(now);
        Self { started: Some(now), last_request, fir_sequence: 0 }
    }

    #[cfg(test)]
    pub fn pending(&self) -> bool {
        self.started.is_some()
    }

    /// Asks for a keyframe. Returns whether this started a new recovery.
    pub fn request(&mut self, now: Instant) -> bool {
        if self.started.is_some() { return false; }
        self.started = Some(now);
        true
    }

    /// The FIR sequence number to send when a request is due, at most once per interval.
    pub fn due(&mut self, now: Instant) -> Option<u8> {
        if self.started.is_none() || now.saturating_duration_since(self.last_request) < REQUEST_INTERVAL { return None; }
        let sequence = self.fir_sequence;
        self.fir_sequence = sequence.wrapping_add(1);
        self.last_request = now;
        Some(sequence)
    }

    /// How long the pending recovery has waited, or zero.
    pub fn waiting(&self, now: Instant) -> Duration {
        self.started.map_or(Duration::ZERO, |started| now.saturating_duration_since(started))
    }

    /// Ends the pending recovery on an accepted sync sample and returns its wait.
    pub fn on_sync(&mut self, now: Instant) -> Option<Duration> {
        let started = self.started.take()?;
        Some(now.saturating_duration_since(started))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_stream_requests_its_first_keyframe_immediately_then_once_a_second() {
        let origin = Instant::now();
        let mut recovery = KeyframeRecovery::new(origin);
        assert!(recovery.pending());
        assert_eq!(recovery.due(origin), Some(0));
        assert_eq!(recovery.due(origin + Duration::from_millis(500)), None);
        assert_eq!(recovery.due(origin + Duration::from_millis(1000)), Some(1));
        assert_eq!(recovery.waiting(origin + Duration::from_millis(1500)), Duration::from_millis(1500));
    }

    #[test]
    fn a_sync_sample_ends_the_recovery_and_reports_its_wait() {
        let origin = Instant::now();
        let mut recovery = KeyframeRecovery::new(origin);
        assert_eq!(recovery.on_sync(origin + Duration::from_millis(40)), Some(Duration::from_millis(40)));
        assert!(!recovery.pending());
        assert_eq!(recovery.on_sync(origin + Duration::from_millis(80)), None);
        assert_eq!(recovery.due(origin + Duration::from_secs(5)), None);
        assert_eq!(recovery.waiting(origin + Duration::from_secs(5)), Duration::ZERO);
    }

    #[test]
    fn repeated_requests_keep_the_first_start_and_the_request_pacing() {
        let origin = Instant::now();
        let mut recovery = KeyframeRecovery::new(origin);
        assert_eq!(recovery.due(origin), Some(0));
        recovery.on_sync(origin);
        let later = origin + Duration::from_millis(300);
        assert!(recovery.request(later));
        assert!(!recovery.request(later + Duration::from_millis(100)));
        assert_eq!(recovery.waiting(later + Duration::from_millis(200)), Duration::from_millis(200));
        // The previous FIR went out at the origin, so the next is due one interval after it.
        assert_eq!(recovery.due(later), None);
        assert_eq!(recovery.due(origin + Duration::from_secs(1)), Some(1));
    }

    #[test]
    fn fir_sequence_numbers_wrap() {
        let origin = Instant::now();
        let mut recovery = KeyframeRecovery::new(origin);
        let mut sequence = None;
        for second in 0..=256u64 { sequence = recovery.due(origin + Duration::from_secs(second)); }
        assert_eq!(sequence, Some(0));
    }
}
