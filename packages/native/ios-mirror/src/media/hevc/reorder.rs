use std::collections::BTreeMap;

/// RTP sequence-number comparison with 16-bit wraparound (RFC 1982). Returns
/// true if `a` is "before" `b` in sequence order.
#[inline]
fn seq_less_than(a: u16, b: u16) -> bool {
    let diff = b.wrapping_sub(a);
    diff != 0 && diff < 0x8000
}

#[derive(Debug)]
pub(super) struct QueuedPacket {
    pub(super) sequence_number: u16,
    pub(super) timestamp: u32,
    pub(super) marker: bool,
    pub(super) payload: Vec<u8>,
}

/// Buffers same-stream RTP packets until they can be released in sequence
/// order. The first packet of an epoch sets the expected sequence number.
#[derive(Debug, Default)]
pub(super) struct ReorderBuffer {
    packets: BTreeMap<u16, QueuedPacket>,
    bytes: usize,
    next_sequence_number: Option<u16>,
}

impl ReorderBuffer {
    /// Drops every buffered packet and forgets the expected sequence number.
    pub(super) fn clear(&mut self) {
        self.packets.clear();
        self.bytes = 0;
        self.next_sequence_number = None;
    }

    /// Buffers a packet unless it is late or a duplicate. Returns whether the
    /// packet was accepted.
    pub(super) fn insert(&mut self, packet: QueuedPacket) -> bool {
        if let Some(next) = self.next_sequence_number {
            if seq_less_than(packet.sequence_number, next) {
                return false;
            }
        } else {
            self.next_sequence_number = Some(packet.sequence_number);
        }
        if self.packets.contains_key(&packet.sequence_number) {
            return false;
        }
        self.bytes = self.bytes.saturating_add(packet.payload.len());
        self.packets.insert(packet.sequence_number, packet);
        true
    }

    /// Releases the packet with the expected sequence number, if buffered.
    pub(super) fn pop_next(&mut self) -> Option<QueuedPacket> {
        let next = self.next_sequence_number?;
        let packet = self.packets.remove(&next)?;
        self.bytes = self.bytes.saturating_sub(packet.payload.len());
        self.next_sequence_number = Some(next.wrapping_add(1));
        Some(packet)
    }

    pub(super) fn exceeds(&self, max_packets: usize, max_bytes: usize) -> bool {
        self.packets.len() > max_packets || self.bytes > max_bytes
    }

    /// Gives up on the missing packets and expects the oldest buffered packet
    /// after the current position (or after `fallback` when none is expected).
    pub(super) fn skip_gap(&mut self, fallback: u16) {
        let expected = self.next_sequence_number.unwrap_or(fallback);
        self.next_sequence_number = self
            .packets
            .keys()
            .min_by_key(|sequence| sequence.wrapping_sub(expected))
            .copied();
    }
}
