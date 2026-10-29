// Jackson Coxson
//
// HEVC RTP depacketization (RFC 7798) for the CoreDevice display stream.
//
// The device sends HEVC (H.265) over plaintext RTP, dynamic payload type 100.
//
// We reorder packets by RTP sequence number (the transport is UDP, so they can
// arrive out of order) and reassemble complete access units. The strict product
// path emits CoreMedia-compatible length-prefixed samples.
//
// - `reorder`: the bounded RTP sequence-number reorder buffer.
// - `payload`: RFC 7798 single-NAL, aggregation (AP) and fragmentation (FU) payloads.
// - `sps`: the bit reader, RBSP decoding and the SPS fields the decoder configuration needs.
// - `parameter_sets`: the committed VPS/SPS/PPS snapshot and its revision.
// - `assembler`: access-unit boundaries, IRAP gating and the public assembler.

mod assembler;
mod parameter_sets;
mod payload;
mod reorder;
mod sps;
#[cfg(test)]
mod test_support;

pub use assembler::HevcAccessUnitAssembler;
pub use sps::{GeneralProfile, SpsInfo};

const HEVC_NAL_HEADER_LEN: usize = 2;

const NAL_TYPE_AP: u8 = 48;
const NAL_TYPE_FU: u8 = 49;

// Parameter-set NAL unit types.
const NAL_TYPE_VPS: u8 = 32;
const NAL_TYPE_SPS: u8 = 33;
const NAL_TYPE_PPS: u8 = 34;

const NAL_TYPE_IRAP_LOW: u8 = 16;
const NAL_TYPE_IRAP_HIGH: u8 = 23;

/// Highest VCL NAL unit type (coded slice segments occupy 0..=31).
const NAL_TYPE_VCL_HIGH: u8 = 31;

const MAX_REORDER_BUFFER: usize = 128;
const MAX_REORDER_BYTES: usize = 4 * 1024 * 1024;
const MAX_NAL_UNIT_SIZE: usize = 16 * 1024 * 1024;
const MAX_PARAMETER_SET_SIZE: usize = 1024 * 1024;
const MAX_ACCESS_UNIT_SIZE: usize = 32 * 1024 * 1024;
const MAX_NAL_UNIT_COUNT: usize = 256;

#[inline]
fn nal_type(nal_header_byte0: u8) -> u8 {
    (nal_header_byte0 >> 1) & 0x3f
}

#[inline]
fn is_irap(t: u8) -> bool {
    (NAL_TYPE_IRAP_LOW..=NAL_TYPE_IRAP_HIGH).contains(&t)
}

#[inline]
fn is_vcl(t: u8) -> bool {
    t <= NAL_TYPE_VCL_HIGH
}

/// Rejects a set forbidden_zero_bit and a zero `nuh_temporal_id_plus1`.
fn validate_payload_header(payload: &[u8]) -> Result<(), HevcDiscontinuity> {
    if payload[0] & 0x80 != 0 || payload[1] & 0x07 == 0 {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    Ok(())
}

/// A complete HEVC decoder configuration observed on a marker-closed access
/// unit.
///
/// NAL bytes include the two-byte HEVC header and exclude Annex-B start codes
/// and length prefixes. `revision` starts at one and advances only when a
/// complete, non-dropped access unit commits changed parameter-set bytes.
/// `sps` is parsed from that same committed SPS; its pixel dimensions already
/// apply the conformance window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HevcParameterSets {
    pub revision: u64,
    pub sps: SpsInfo,
    pub video_parameter_set: Vec<u8>,
    pub sequence_parameter_set: Vec<u8>,
    pub picture_parameter_set: Vec<u8>,
}

/// One complete HEVC access unit in the four-byte length-prefixed format
/// consumed by CoreMedia and VideoToolbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HevcAccessUnit {
    pub ssrc: u32,
    pub rtp_timestamp: u32,
    pub first_sequence_number: u16,
    pub last_sequence_number: u16,
    pub parameter_set_revision: u64,
    pub is_sync: bool,
    pub bytes: Vec<u8>,
}

/// A packet that does not belong to the exact stream selected by media
/// negotiation. Rejected packets never mutate sequence or access-unit state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HevcPacketRejection {
    UnexpectedPayloadType,
    UnexpectedSource,
}

/// A same-stream integrity failure that caused the current access unit to be
/// discarded. Callers should request an intra refresh after these events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HevcDiscontinuity {
    SequenceGap,
    TimestampChangedWithoutMarker,
    MalformedPayload,
    NalUnitTooLarge,
    ParameterSetTooLarge,
    AccessUnitTooLarge,
    TooManyNalUnits,
    MissingParameterSets,
}

/// Ordered output from [`HevcAccessUnitAssembler::push_packet`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HevcDepacketizerEvent {
    AccessUnit(HevcAccessUnit),
    Discontinuity(HevcDiscontinuity),
    PacketRejected(HevcPacketRejection),
}

#[derive(Debug, Clone, Copy)]
struct DepacketizerLimits {
    max_reorder_packets: usize,
    max_reorder_bytes: usize,
    max_nal_unit_size: usize,
    max_parameter_set_size: usize,
    max_access_unit_size: usize,
    max_nal_unit_count: usize,
}

impl Default for DepacketizerLimits {
    fn default() -> Self {
        Self {
            max_reorder_packets: MAX_REORDER_BUFFER,
            max_reorder_bytes: MAX_REORDER_BYTES,
            max_nal_unit_size: MAX_NAL_UNIT_SIZE,
            max_parameter_set_size: MAX_PARAMETER_SET_SIZE,
            max_access_unit_size: MAX_ACCESS_UNIT_SIZE,
            max_nal_unit_count: MAX_NAL_UNIT_COUNT,
        }
    }
}
