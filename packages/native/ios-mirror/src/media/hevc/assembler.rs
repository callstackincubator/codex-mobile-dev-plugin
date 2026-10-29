use super::{
    DepacketizerLimits, HEVC_NAL_HEADER_LEN, HevcAccessUnit, HevcDepacketizerEvent,
    HevcDiscontinuity, HevcPacketRejection, HevcParameterSets, NAL_TYPE_PPS, NAL_TYPE_SPS,
    NAL_TYPE_VPS, is_irap, is_vcl, nal_type,
    parameter_sets::ParameterSetStore,
    payload::PayloadAssembler,
    reorder::{QueuedPacket, ReorderBuffer},
};

#[derive(Debug, Default)]
struct CurrentAccessUnit {
    timestamp: Option<u32>,
    first_sequence_number: u16,
    last_sequence_number: u16,
    encoded_size: usize,
    nals: Vec<Vec<u8>>,
}

impl CurrentAccessUnit {
    fn begin(&mut self, timestamp: u32, sequence_number: u16) {
        debug_assert!(self.timestamp.is_none());
        self.timestamp = Some(timestamp);
        self.first_sequence_number = sequence_number;
        self.last_sequence_number = sequence_number;
    }

    fn append(
        &mut self,
        nal: Vec<u8>,
        sequence_number: u16,
        limits: DepacketizerLimits,
    ) -> Result<(), HevcDiscontinuity> {
        if self.nals.len() >= limits.max_nal_unit_count {
            return Err(HevcDiscontinuity::TooManyNalUnits);
        }
        let encoded_size = self
            .encoded_size
            .checked_add(4)
            .and_then(|size| size.checked_add(nal.len()))
            .ok_or(HevcDiscontinuity::AccessUnitTooLarge)?;
        if encoded_size > limits.max_access_unit_size {
            return Err(HevcDiscontinuity::AccessUnitTooLarge);
        }
        self.encoded_size = encoded_size;
        self.last_sequence_number = sequence_number;
        self.nals.push(nal);
        Ok(())
    }
}

fn starts_with_irap_picture(nals: &[Vec<u8>]) -> bool {
    let Some(first_vcl_index) = nals
        .iter()
        .position(|nal| nal.first().is_some_and(|byte| is_vcl(nal_type(*byte))))
    else {
        return false;
    };
    let first_vcl = &nals[first_vcl_index];
    is_irap(nal_type(first_vcl[0]))
        && first_vcl
            .get(HEVC_NAL_HEADER_LEN)
            .is_some_and(|byte| byte & 0x80 != 0)
}

fn is_decoder_ready_initial_access_unit(nals: &[Vec<u8>]) -> bool {
    let Some(first_vcl_index) = nals
        .iter()
        .position(|nal| nal.first().is_some_and(|byte| is_vcl(nal_type(*byte))))
    else {
        return false;
    };
    let parameter_nals = &nals[..first_vcl_index];
    let has_parameter_set = |expected| {
        parameter_nals
            .iter()
            .any(|nal| nal.first().is_some_and(|byte| nal_type(*byte) == expected))
    };

    has_parameter_set(NAL_TYPE_VPS)
        && has_parameter_set(NAL_TYPE_SPS)
        && has_parameter_set(NAL_TYPE_PPS)
        && starts_with_irap_picture(nals)
}

/// Reorders negotiated DisplayService RTP, reconstructs RFC 7798 payloads, and
/// emits only complete marker-closed HEVC access units.
///
/// A new stream epoch and every integrity failure require an independently
/// decodable IRAP picture before predicted frames may reach the decoder. The
/// first observed access unit may start the epoch immediately when it carries
/// VPS/SPS/PPS before the first slice of that IRAP picture. Modest reordering is
/// buffered; a bounded gap, malformed payload, incomplete FU, timestamp
/// discontinuity, or allocation-limit breach drops the complete access unit,
/// emits a typed discontinuity, and rearms that sync-sample gate.
#[derive(Debug)]
pub struct HevcAccessUnitAssembler {
    expected_payload_type: u8,
    expected_ssrc: u32,
    limits: DepacketizerLimits,
    reorder: ReorderBuffer,
    requires_sync_sample: bool,
    payload_assembler: PayloadAssembler,
    current: CurrentAccessUnit,
    parameter_sets: ParameterSetStore,
}

impl HevcAccessUnitAssembler {
    /// Creates an assembler bound to the payload type and SSRC returned by the
    /// authenticated media-negotiation answer.
    pub fn new(expected_payload_type: u8, expected_ssrc: u32) -> Self {
        Self::with_limits(
            expected_payload_type,
            expected_ssrc,
            DepacketizerLimits::default(),
        )
    }

    fn with_limits(
        expected_payload_type: u8,
        expected_ssrc: u32,
        limits: DepacketizerLimits,
    ) -> Self {
        Self {
            expected_payload_type,
            expected_ssrc,
            limits,
            reorder: ReorderBuffer::default(),
            requires_sync_sample: true,
            payload_assembler: PayloadAssembler::new(
                limits.max_nal_unit_size,
                limits.max_nal_unit_count,
            ),
            current: CurrentAccessUnit::default(),
            parameter_sets: ParameterSetStore::default(),
        }
    }

    /// Returns a copy of the latest complete parameter-set configuration.
    pub fn parameter_sets(&self) -> Option<HevcParameterSets> {
        self.parameter_sets.snapshot()
    }

    /// Clears all buffered packets, partial NAL/AU bytes, sequence state, and
    /// cached parameter sets. After return, no pre-reset bytes can be emitted.
    #[cfg(test)]
    pub fn reset(&mut self) {
        self.reorder.clear();
        self.requires_sync_sample = true;
        self.drop_current_access_unit();
        self.parameter_sets = ParameterSetStore::default();
    }

    /// Drops incomplete transport state while preserving the last valid codec
    /// configuration and requires a fresh IRAP picture before decoding resumes.
    pub fn mark_stream_discontinuity(&mut self) {
        self.reorder.clear();
        self.requires_sync_sample = true;
        self.drop_current_access_unit();
    }

    /// Adds one already-parsed RTP packet and returns every access unit or
    /// integrity event made ready by it.
    pub fn push_packet(
        &mut self,
        packet: &crate::media::rtp::RtpPacket<'_>,
    ) -> Vec<HevcDepacketizerEvent> {
        if packet.payload_type != self.expected_payload_type {
            return vec![HevcDepacketizerEvent::PacketRejected(
                HevcPacketRejection::UnexpectedPayloadType,
            )];
        }
        if packet.ssrc != self.expected_ssrc {
            return vec![HevcDepacketizerEvent::PacketRejected(
                HevcPacketRejection::UnexpectedSource,
            )];
        }

        let queued = QueuedPacket {
            sequence_number: packet.sequence_number,
            timestamp: packet.timestamp,
            marker: packet.marker,
            payload: packet.payload.to_vec(),
        };
        if !self.reorder.insert(queued) {
            return Vec::new();
        }

        let mut events = self.drain_contiguous();
        if self
            .reorder
            .exceeds(self.limits.max_reorder_packets, self.limits.max_reorder_bytes)
        {
            self.discontinue(&mut events, HevcDiscontinuity::SequenceGap);
            self.reorder.skip_gap(packet.sequence_number);
            events.extend(self.drain_contiguous());
        }
        events
    }

    fn drain_contiguous(&mut self) -> Vec<HevcDepacketizerEvent> {
        let mut events = Vec::new();
        while let Some(packet) = self.reorder.pop_next() {
            events.extend(self.consume_ordered(packet));
        }
        events
    }

    fn consume_ordered(&mut self, packet: QueuedPacket) -> Vec<HevcDepacketizerEvent> {
        let mut events = Vec::new();
        if let Some(timestamp) = self.current.timestamp
            && timestamp != packet.timestamp
        {
            self.discontinue(&mut events, HevcDiscontinuity::TimestampChangedWithoutMarker);
        }
        if self.current.timestamp.is_none() {
            self.current.begin(packet.timestamp, packet.sequence_number);
        }

        let nals = match self
            .payload_assembler
            .process(packet.timestamp, &packet.payload)
        {
            Ok(nals) => nals,
            Err(discontinuity) => {
                self.discontinue(&mut events, discontinuity);
                return events;
            }
        };
        for nal in nals {
            if let Err(discontinuity) =
                self.current
                    .append(nal, packet.sequence_number, self.limits)
            {
                self.discontinue(&mut events, discontinuity);
                return events;
            }
        }
        self.current.last_sequence_number = packet.sequence_number;

        if !packet.marker {
            return events;
        }
        if self.payload_assembler.has_fragmented_nal() {
            self.discontinue(&mut events, HevcDiscontinuity::MalformedPayload);
            return events;
        }
        if let Err(discontinuity) = self.finish_access_unit(&mut events) {
            self.discontinue(&mut events, discontinuity);
        }
        events
    }

    /// Closes the current access unit at its marker. Emits it when it is
    /// decodable; an integrity failure is returned for the caller to report.
    fn finish_access_unit(
        &mut self,
        events: &mut Vec<HevcDepacketizerEvent>,
    ) -> Result<(), HevcDiscontinuity> {
        let current = std::mem::take(&mut self.current);
        let Some(timestamp) = current.timestamp else {
            return Ok(());
        };
        let has_vcl = current.nals.iter().any(|nal| is_vcl(nal_type(nal[0])));
        let had_configuration = self.parameter_sets.is_complete();
        if has_vcl
            && self.requires_sync_sample
            && !had_configuration
            && !is_decoder_ready_initial_access_unit(&current.nals)
        {
            return Ok(());
        }
        self.parameter_sets
            .commit(&current.nals, self.limits.max_parameter_set_size)?;

        if !has_vcl {
            return Ok(());
        }
        let Some(parameter_sets) = self.parameter_sets.snapshot() else {
            return Err(HevcDiscontinuity::MissingParameterSets);
        };

        let is_sync = starts_with_irap_picture(&current.nals);
        if self.requires_sync_sample && !is_sync {
            return Ok(());
        }
        let mut bytes = Vec::with_capacity(current.encoded_size);
        for nal in current.nals {
            let length =
                u32::try_from(nal.len()).map_err(|_| HevcDiscontinuity::NalUnitTooLarge)?;
            bytes.extend_from_slice(&length.to_be_bytes());
            bytes.extend_from_slice(&nal);
        }
        self.requires_sync_sample = false;
        events.push(HevcDepacketizerEvent::AccessUnit(HevcAccessUnit {
            ssrc: self.expected_ssrc,
            rtp_timestamp: timestamp,
            first_sequence_number: current.first_sequence_number,
            last_sequence_number: current.last_sequence_number,
            parameter_set_revision: parameter_sets.revision,
            is_sync,
            bytes,
        }));
        Ok(())
    }

    /// Reports an integrity failure: drops the open access unit and requires a
    /// fresh IRAP picture before decoding resumes.
    fn discontinue(&mut self, events: &mut Vec<HevcDepacketizerEvent>, reason: HevcDiscontinuity) {
        events.push(HevcDepacketizerEvent::Discontinuity(reason));
        self.drop_current_access_unit();
        self.requires_sync_sample = true;
    }

    fn drop_current_access_unit(&mut self) {
        self.payload_assembler.reset();
        self.current = CurrentAccessUnit::default();
    }
}

#[cfg(test)]
#[path = "assembler_tests.rs"]
mod tests;
