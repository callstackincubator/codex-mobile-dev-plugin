// Jackson Coxson
//
// HEVC RTP depacketization (RFC 7798) for the CoreDevice display stream.
//
// The device sends HEVC (H.265) over plaintext RTP, dynamic payload type 100.
//
// We reorder packets by RTP sequence number (the transport is UDP, so they can
// arrive out of order) and reassemble complete access units. The strict product
// path emits CoreMedia-compatible length-prefixed samples.

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
const MAX_CODED_PIXEL_DIMENSION: u32 = 16_384;
const MAX_CODED_PIXEL_COUNT: u64 = 128 * 1024 * 1024;

// Apple's DisplayService appends this exact non-HEVC trailer to coded-slice
// NAL units. `avconferenced` strips it before decode. Match the complete suffix
// only, and only on VCL NAL units, so conforming streams are unchanged.
const DISPLAYSERVICE_NAL_TRAILER: [u8; 14] = [
    0x04, 0xf0, 0x0a, 0xc0, 0x00, 0x00, 0x03, 0x00, 0x00, 0x04, 0xec, 0x0a, 0xb0, 0x03,
];

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

/// RTP sequence-number comparison with 16-bit wraparound (RFC 1982). Returns
/// true if `a` is "before" `b` in sequence order.
#[inline]
fn seq_less_than(a: u16, b: u16) -> bool {
    let diff = b.wrapping_sub(a);
    diff != 0 && diff < 0x8000
}

/// A complete HEVC decoder configuration observed on a marker-closed access
/// unit.
///
/// NAL bytes include the two-byte HEVC header and exclude Annex-B start codes
/// and length prefixes. `revision` starts at one and advances only when a
/// complete, non-dropped access unit commits changed parameter-set bytes.
/// Pixel dimensions come from that same committed SPS after applying its
/// conformance window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HevcParameterSets {
    pub revision: u64,
    /// Displayed luma-sample width after applying the SPS conformance window.
    pub pixel_width: u32,
    /// Displayed luma-sample height after applying the SPS conformance window.
    pub pixel_height: u32,
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

#[derive(Debug)]
struct QueuedPacket {
    sequence_number: u16,
    timestamp: u32,
    marker: bool,
    payload: Vec<u8>,
}

#[derive(Debug)]
struct FragmentedNal {
    timestamp: u32,
    payload_header_masked: u8,
    payload_header_second: u8,
    nal_type: u8,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct PayloadAssembler {
    fragmented_nal: Option<FragmentedNal>,
    max_nal_unit_size: usize,
    max_nal_unit_count: usize,
}

impl PayloadAssembler {
    fn new(max_nal_unit_size: usize, max_nal_unit_count: usize) -> Self {
        Self {
            fragmented_nal: None,
            max_nal_unit_size,
            max_nal_unit_count,
        }
    }

    fn reset(&mut self) {
        self.fragmented_nal = None;
    }

    fn has_fragmented_nal(&self) -> bool {
        self.fragmented_nal.is_some()
    }

    fn process(
        &mut self,
        timestamp: u32,
        payload: &[u8],
    ) -> Result<Vec<Vec<u8>>, HevcDiscontinuity> {
        if payload.len() < HEVC_NAL_HEADER_LEN {
            return Err(HevcDiscontinuity::MalformedPayload);
        }
        validate_payload_header(payload)?;

        match nal_type(payload[0]) {
            NAL_TYPE_AP => self.process_aggregation(payload),
            NAL_TYPE_FU => self.process_fragmentation(timestamp, payload),
            0..=47 => {
                if self.fragmented_nal.is_some() {
                    return Err(HevcDiscontinuity::MalformedPayload);
                }
                let nal = validate_complete_nal(payload, self.max_nal_unit_size)?;
                Ok(vec![nal])
            }
            // PACI (50) is not negotiated by the Device Hub offer. Types above
            // it are reserved. Neither can be interpreted as a single NAL.
            _ => Err(HevcDiscontinuity::MalformedPayload),
        }
    }

    fn process_aggregation(&mut self, payload: &[u8]) -> Result<Vec<Vec<u8>>, HevcDiscontinuity> {
        if self.fragmented_nal.is_some() {
            return Err(HevcDiscontinuity::MalformedPayload);
        }

        // Device Hub negotiates transmission order == decoding order
        // (sprop-max-don-diff=0), so RFC 7798 forbids DONL/DOND fields.
        let mut offset = HEVC_NAL_HEADER_LEN;
        let mut nals = Vec::new();
        while offset < payload.len() {
            let size_bytes = payload
                .get(offset..offset + 2)
                .ok_or(HevcDiscontinuity::MalformedPayload)?;
            let size = u16::from_be_bytes([size_bytes[0], size_bytes[1]]) as usize;
            offset += 2;
            if size == 0 {
                return Err(HevcDiscontinuity::MalformedPayload);
            }
            let end = offset
                .checked_add(size)
                .ok_or(HevcDiscontinuity::MalformedPayload)?;
            let nal = payload
                .get(offset..end)
                .ok_or(HevcDiscontinuity::MalformedPayload)?;
            if nals.len() >= self.max_nal_unit_count {
                return Err(HevcDiscontinuity::TooManyNalUnits);
            }
            nals.push(validate_complete_nal(nal, self.max_nal_unit_size)?);
            offset = end;
        }
        if nals.len() < 2 {
            return Err(HevcDiscontinuity::MalformedPayload);
        }
        Ok(nals)
    }

    fn process_fragmentation(
        &mut self,
        timestamp: u32,
        payload: &[u8],
    ) -> Result<Vec<Vec<u8>>, HevcDiscontinuity> {
        let fu_header = *payload
            .get(HEVC_NAL_HEADER_LEN)
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        let fragment = payload
            .get(HEVC_NAL_HEADER_LEN + 1..)
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        if fragment.is_empty() {
            return Err(HevcDiscontinuity::MalformedPayload);
        }

        let start = fu_header & 0x80 != 0;
        let end = fu_header & 0x40 != 0;
        let original_type = fu_header & 0x3f;
        if start && end || original_type >= NAL_TYPE_AP {
            return Err(HevcDiscontinuity::MalformedPayload);
        }

        if start {
            if self.fragmented_nal.is_some() {
                return Err(HevcDiscontinuity::MalformedPayload);
            }
            let reconstructed_header = [(payload[0] & 0x81) | (original_type << 1), payload[1]];
            let size = reconstructed_header
                .len()
                .checked_add(fragment.len())
                .ok_or(HevcDiscontinuity::NalUnitTooLarge)?;
            if size > self.max_nal_unit_size {
                return Err(HevcDiscontinuity::NalUnitTooLarge);
            }
            let mut bytes = Vec::with_capacity(size);
            bytes.extend_from_slice(&reconstructed_header);
            bytes.extend_from_slice(fragment);
            self.fragmented_nal = Some(FragmentedNal {
                timestamp,
                payload_header_masked: payload[0] & 0x81,
                payload_header_second: payload[1],
                nal_type: original_type,
                bytes,
            });
            return Ok(Vec::new());
        }

        let fragmented_nal = self
            .fragmented_nal
            .as_mut()
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        if fragmented_nal.timestamp != timestamp
            || fragmented_nal.payload_header_masked != payload[0] & 0x81
            || fragmented_nal.payload_header_second != payload[1]
            || fragmented_nal.nal_type != original_type
        {
            return Err(HevcDiscontinuity::MalformedPayload);
        }
        let size = fragmented_nal
            .bytes
            .len()
            .checked_add(fragment.len())
            .ok_or(HevcDiscontinuity::NalUnitTooLarge)?;
        if size > self.max_nal_unit_size {
            return Err(HevcDiscontinuity::NalUnitTooLarge);
        }
        fragmented_nal.bytes.extend_from_slice(fragment);

        if !end {
            return Ok(Vec::new());
        }
        let Some(complete) = self
            .fragmented_nal
            .take()
            .map(|fragmented| fragmented.bytes)
        else {
            return Err(HevcDiscontinuity::MalformedPayload);
        };
        Ok(vec![validate_complete_nal(
            &complete,
            self.max_nal_unit_size,
        )?])
    }
}

fn validate_payload_header(payload: &[u8]) -> Result<(), HevcDiscontinuity> {
    if payload[0] & 0x80 != 0 || payload[1] & 0x07 == 0 {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    Ok(())
}

fn validate_complete_nal(
    nal: &[u8],
    max_nal_unit_size: usize,
) -> Result<Vec<u8>, HevcDiscontinuity> {
    if nal.len() > max_nal_unit_size {
        return Err(HevcDiscontinuity::NalUnitTooLarge);
    }
    if nal.len() <= HEVC_NAL_HEADER_LEN {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    validate_payload_header(nal)?;
    if nal_type(nal[0]) >= NAL_TYPE_AP {
        return Err(HevcDiscontinuity::MalformedPayload);
    }

    let mut end = nal.len();
    if is_vcl(nal_type(nal[0]))
        && nal.len() >= HEVC_NAL_HEADER_LEN + DISPLAYSERVICE_NAL_TRAILER.len()
        && nal.ends_with(&DISPLAYSERVICE_NAL_TRAILER)
    {
        end -= DISPLAYSERVICE_NAL_TRAILER.len();
    }
    if end <= HEVC_NAL_HEADER_LEN {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    Ok(nal[..end].to_vec())
}

/// A bounded MSB-first bit reader for the SPS prefix.
#[derive(Debug)]
struct BitReader<'a> {
    bytes: &'a [u8],
    bit_position: usize,
}

impl<'a> BitReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            bit_position: 0,
        }
    }

    fn read_bit(&mut self) -> Result<bool, HevcDiscontinuity> {
        let byte = *self
            .bytes
            .get(self.bit_position / 8)
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        let shift = 7 - self.bit_position % 8;
        self.bit_position = self
            .bit_position
            .checked_add(1)
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        Ok(byte & (1 << shift) != 0)
    }

    fn read_bits(&mut self, count: usize) -> Result<u64, HevcDiscontinuity> {
        if count > u64::BITS as usize {
            return Err(HevcDiscontinuity::MalformedPayload);
        }
        self.ensure_bits(count)?;

        let mut value = 0u64;
        for _ in 0..count {
            value = (value << 1) | u64::from(self.read_bit()?);
        }
        Ok(value)
    }

    fn skip_bits(&mut self, count: usize) -> Result<(), HevcDiscontinuity> {
        self.bit_position = self.ensure_bits(count)?;
        Ok(())
    }

    fn ensure_bits(&self, count: usize) -> Result<usize, HevcDiscontinuity> {
        let end = self
            .bit_position
            .checked_add(count)
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        let total_bits = self
            .bytes
            .len()
            .checked_mul(8)
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        if end > total_bits {
            return Err(HevcDiscontinuity::MalformedPayload);
        }
        Ok(end)
    }

    fn read_ue(&mut self) -> Result<u32, HevcDiscontinuity> {
        let mut leading_zero_bits = 0usize;
        while !self.read_bit()? {
            leading_zero_bits = leading_zero_bits
                .checked_add(1)
                .ok_or(HevcDiscontinuity::MalformedPayload)?;
            if leading_zero_bits > 32 {
                return Err(HevcDiscontinuity::MalformedPayload);
            }
        }

        let suffix = self.read_bits(leading_zero_bits)?;
        let base = (1u64 << leading_zero_bits)
            .checked_sub(1)
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        let value = base
            .checked_add(suffix)
            .ok_or(HevcDiscontinuity::MalformedPayload)?;
        u32::try_from(value).map_err(|_| HevcDiscontinuity::MalformedPayload)
    }
}

/// Removes HEVC emulation-prevention bytes while rejecting illegal EBSP
/// sequences. Allocation is capped by the parameter-set safety limit.
fn decode_rbsp(ebsp: &[u8]) -> Result<Vec<u8>, HevcDiscontinuity> {
    if ebsp.len() > MAX_PARAMETER_SET_SIZE {
        return Err(HevcDiscontinuity::ParameterSetTooLarge);
    }

    let mut rbsp = Vec::with_capacity(ebsp.len());
    let mut consecutive_zero_bytes = 0usize;
    let mut index = 0usize;
    while index < ebsp.len() {
        let byte = ebsp[index];
        if consecutive_zero_bytes == 2 {
            match byte {
                0x00..=0x02 => return Err(HevcDiscontinuity::MalformedPayload),
                0x03 => {
                    if let Some(following) = ebsp.get(index + 1)
                        && *following > 0x03
                    {
                        return Err(HevcDiscontinuity::MalformedPayload);
                    }
                    consecutive_zero_bytes = 0;
                    index += 1;
                    continue;
                }
                _ => {}
            }
        }

        rbsp.push(byte);
        consecutive_zero_bytes = if byte == 0 {
            consecutive_zero_bytes + 1
        } else {
            0
        };
        index += 1;
    }
    Ok(rbsp)
}

/// Skips HEVC `profile_tier_level(1, max_sub_layers_minus1)`.
fn skip_profile_tier_level(
    bits: &mut BitReader<'_>,
    max_sub_layers_minus1: usize,
) -> Result<(), HevcDiscontinuity> {
    // General profile fields are 88 bits, followed by general_level_idc.
    bits.skip_bits(96)?;

    let mut profile_present = [false; 6];
    let mut level_present = [false; 6];
    for index in 0..max_sub_layers_minus1 {
        profile_present[index] = bits.read_bit()?;
        level_present[index] = bits.read_bit()?;
    }
    if max_sub_layers_minus1 > 0 {
        for _ in max_sub_layers_minus1..8 {
            if bits.read_bits(2)? != 0 {
                return Err(HevcDiscontinuity::MalformedPayload);
            }
        }
    }
    for index in 0..max_sub_layers_minus1 {
        if profile_present[index] {
            bits.skip_bits(88)?;
        }
        if level_present[index] {
            bits.read_bits(8)?;
        }
    }
    Ok(())
}

/// Parses the dimension-bearing SPS prefix and returns displayed luma-sample
/// dimensions after conformance-window cropping.
///
/// The parser intentionally stops after the conformance window; the remaining
/// SPS syntax is consumed by the decoder. Every bit needed to derive geometry
/// is range-checked, and malformed EBSP, Exp-Golomb overflow, invalid chroma
/// formats, impossible sub-layer counts, or over-cropping are rejected.
fn parse_sps_dimensions(sps: &[u8]) -> Result<(u32, u32), HevcDiscontinuity> {
    if sps.len() > MAX_PARAMETER_SET_SIZE {
        return Err(HevcDiscontinuity::ParameterSetTooLarge);
    }
    if sps.len() <= HEVC_NAL_HEADER_LEN {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    validate_payload_header(sps)?;
    let layer_id = ((sps[0] & 0x01) << 5) | (sps[1] >> 3);
    if nal_type(sps[0]) != NAL_TYPE_SPS
        || layer_id != 0
        || sps[1] & 0x07 != 1
        || sps.last() == Some(&0)
    {
        return Err(HevcDiscontinuity::MalformedPayload);
    }

    let rbsp = decode_rbsp(&sps[HEVC_NAL_HEADER_LEN..])?;
    let mut bits = BitReader::new(&rbsp);
    bits.read_bits(4)?; // sps_video_parameter_set_id
    let max_sub_layers_minus1 = bits.read_bits(3)? as usize;
    if max_sub_layers_minus1 > 6 {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    let temporal_id_nesting = bits.read_bit()?;
    if max_sub_layers_minus1 == 0 && !temporal_id_nesting {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    skip_profile_tier_level(&mut bits, max_sub_layers_minus1)?;

    let sequence_parameter_set_id = bits.read_ue()?;
    if sequence_parameter_set_id > 15 {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    let chroma_format_idc = bits.read_ue()?;
    if chroma_format_idc > 3 {
        return Err(HevcDiscontinuity::MalformedPayload);
    }
    let separate_colour_plane = chroma_format_idc == 3 && bits.read_bit()?;

    let coded_width = bits.read_ue()?;
    let coded_height = bits.read_ue()?;
    let coded_pixel_count = u64::from(coded_width)
        .checked_mul(u64::from(coded_height))
        .ok_or(HevcDiscontinuity::MalformedPayload)?;
    if coded_width == 0
        || coded_height == 0
        || coded_width > MAX_CODED_PIXEL_DIMENSION
        || coded_height > MAX_CODED_PIXEL_DIMENSION
        || coded_pixel_count > MAX_CODED_PIXEL_COUNT
    {
        return Err(HevcDiscontinuity::MalformedPayload);
    }

    let (crop_unit_x, crop_unit_y) = match (chroma_format_idc, separate_colour_plane) {
        (0, _) | (3, _) => (1u32, 1u32),
        (1, false) => (2, 2),
        (2, false) => (2, 1),
        _ => return Err(HevcDiscontinuity::MalformedPayload),
    };
    let (left, right, top, bottom) = if bits.read_bit()? {
        (
            bits.read_ue()?,
            bits.read_ue()?,
            bits.read_ue()?,
            bits.read_ue()?,
        )
    } else {
        (0, 0, 0, 0)
    };
    let horizontal_crop = left
        .checked_add(right)
        .and_then(|offset| offset.checked_mul(crop_unit_x))
        .ok_or(HevcDiscontinuity::MalformedPayload)?;
    let vertical_crop = top
        .checked_add(bottom)
        .and_then(|offset| offset.checked_mul(crop_unit_y))
        .ok_or(HevcDiscontinuity::MalformedPayload)?;
    let pixel_width = coded_width
        .checked_sub(horizontal_crop)
        .filter(|width| *width > 0)
        .ok_or(HevcDiscontinuity::MalformedPayload)?;
    let pixel_height = coded_height
        .checked_sub(vertical_crop)
        .filter(|height| *height > 0)
        .ok_or(HevcDiscontinuity::MalformedPayload)?;
    Ok((pixel_width, pixel_height))
}

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
    reorder: std::collections::BTreeMap<u16, QueuedPacket>,
    reorder_bytes: usize,
    next_sequence_number: Option<u16>,
    requires_sync_sample: bool,
    payload_assembler: PayloadAssembler,
    current: CurrentAccessUnit,
    video_parameter_set: Option<Vec<u8>>,
    sequence_parameter_set: Option<Vec<u8>>,
    picture_parameter_set: Option<Vec<u8>>,
    pixel_dimensions: Option<(u32, u32)>,
    parameter_set_revision: u64,
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
            reorder: std::collections::BTreeMap::new(),
            reorder_bytes: 0,
            next_sequence_number: None,
            requires_sync_sample: true,
            payload_assembler: PayloadAssembler::new(
                limits.max_nal_unit_size,
                limits.max_nal_unit_count,
            ),
            current: CurrentAccessUnit::default(),
            video_parameter_set: None,
            sequence_parameter_set: None,
            picture_parameter_set: None,
            pixel_dimensions: None,
            parameter_set_revision: 0,
        }
    }

    /// Returns a copy of the latest complete parameter-set configuration.
    pub fn parameter_sets(&self) -> Option<HevcParameterSets> {
        let (pixel_width, pixel_height) = self.pixel_dimensions?;
        Some(HevcParameterSets {
            revision: self.parameter_set_revision,
            pixel_width,
            pixel_height,
            video_parameter_set: self.video_parameter_set.clone()?,
            sequence_parameter_set: self.sequence_parameter_set.clone()?,
            picture_parameter_set: self.picture_parameter_set.clone()?,
        })
    }

    /// Clears all buffered packets, partial NAL/AU bytes, sequence state, and
    /// cached parameter sets. After return, no pre-reset bytes can be emitted.
    pub fn reset(&mut self) {
        self.reorder.clear();
        self.reorder_bytes = 0;
        self.next_sequence_number = None;
        self.requires_sync_sample = true;
        self.payload_assembler.reset();
        self.current = CurrentAccessUnit::default();
        self.video_parameter_set = None;
        self.sequence_parameter_set = None;
        self.picture_parameter_set = None;
        self.pixel_dimensions = None;
        self.parameter_set_revision = 0;
    }

    /// Drops incomplete transport state while preserving the last valid codec
    /// configuration and requires a fresh IRAP picture before decoding resumes.
    pub fn mark_stream_discontinuity(&mut self) {
        self.reorder.clear();
        self.reorder_bytes = 0;
        self.next_sequence_number = None;
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

        if let Some(next) = self.next_sequence_number {
            if seq_less_than(packet.sequence_number, next) {
                return Vec::new();
            }
        } else {
            self.next_sequence_number = Some(packet.sequence_number);
        }
        if self.reorder.contains_key(&packet.sequence_number) {
            return Vec::new();
        }

        self.reorder_bytes = self.reorder_bytes.saturating_add(packet.payload.len());
        self.reorder.insert(
            packet.sequence_number,
            QueuedPacket {
                sequence_number: packet.sequence_number,
                timestamp: packet.timestamp,
                marker: packet.marker,
                payload: packet.payload.to_vec(),
            },
        );

        let mut events = self.drain_contiguous();
        if self.reorder.len() > self.limits.max_reorder_packets
            || self.reorder_bytes > self.limits.max_reorder_bytes
        {
            events.push(HevcDepacketizerEvent::Discontinuity(
                HevcDiscontinuity::SequenceGap,
            ));
            self.drop_current_access_unit();
            self.requires_sync_sample = true;

            let expected = self.next_sequence_number.unwrap_or(packet.sequence_number);
            self.next_sequence_number = self
                .reorder
                .keys()
                .min_by_key(|sequence| sequence.wrapping_sub(expected))
                .copied();
            events.extend(self.drain_contiguous());
        }
        events
    }

    fn drain_contiguous(&mut self) -> Vec<HevcDepacketizerEvent> {
        let mut events = Vec::new();
        while let Some(next) = self.next_sequence_number {
            let Some(packet) = self.reorder.remove(&next) else {
                break;
            };
            self.reorder_bytes = self.reorder_bytes.saturating_sub(packet.payload.len());
            self.next_sequence_number = Some(next.wrapping_add(1));
            events.extend(self.consume_ordered(packet));
        }
        events
    }

    fn consume_ordered(&mut self, packet: QueuedPacket) -> Vec<HevcDepacketizerEvent> {
        let mut events = Vec::new();
        if let Some(timestamp) = self.current.timestamp
            && timestamp != packet.timestamp
        {
            events.push(HevcDepacketizerEvent::Discontinuity(
                HevcDiscontinuity::TimestampChangedWithoutMarker,
            ));
            self.drop_current_access_unit();
            self.requires_sync_sample = true;
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
                events.push(HevcDepacketizerEvent::Discontinuity(discontinuity));
                self.drop_current_access_unit();
                self.requires_sync_sample = true;
                return events;
            }
        };
        for nal in nals {
            if let Err(discontinuity) =
                self.current
                    .append(nal, packet.sequence_number, self.limits)
            {
                events.push(HevcDepacketizerEvent::Discontinuity(discontinuity));
                self.drop_current_access_unit();
                self.requires_sync_sample = true;
                return events;
            }
        }
        self.current.last_sequence_number = packet.sequence_number;

        if !packet.marker {
            return events;
        }
        if self.payload_assembler.has_fragmented_nal() {
            events.push(HevcDepacketizerEvent::Discontinuity(
                HevcDiscontinuity::MalformedPayload,
            ));
            self.drop_current_access_unit();
            self.requires_sync_sample = true;
            return events;
        }
        if let Some(event) = self.finish_access_unit() {
            events.push(event);
        }
        events
    }

    fn finish_access_unit(&mut self) -> Option<HevcDepacketizerEvent> {
        let current = std::mem::take(&mut self.current);
        let timestamp = current.timestamp?;
        let has_vcl = current.nals.iter().any(|nal| is_vcl(nal_type(nal[0])));
        let had_configuration = self.parameter_sets().is_some();
        if has_vcl
            && self.requires_sync_sample
            && !had_configuration
            && !is_decoder_ready_initial_access_unit(&current.nals)
        {
            return None;
        }
        if let Err(discontinuity) = self.commit_parameter_sets(&current.nals) {
            self.requires_sync_sample = true;
            return Some(HevcDepacketizerEvent::Discontinuity(discontinuity));
        }

        if !has_vcl {
            return None;
        }
        let Some(parameter_sets) = self.parameter_sets() else {
            self.requires_sync_sample = true;
            return Some(HevcDepacketizerEvent::Discontinuity(
                HevcDiscontinuity::MissingParameterSets,
            ));
        };

        let is_sync = starts_with_irap_picture(&current.nals);
        if self.requires_sync_sample && !is_sync {
            return None;
        }
        self.requires_sync_sample = false;
        let mut bytes = Vec::with_capacity(current.encoded_size);
        for nal in current.nals {
            let Ok(length) = u32::try_from(nal.len()) else {
                self.requires_sync_sample = true;
                return Some(HevcDepacketizerEvent::Discontinuity(
                    HevcDiscontinuity::NalUnitTooLarge,
                ));
            };
            bytes.extend_from_slice(&length.to_be_bytes());
            bytes.extend_from_slice(&nal);
        }
        Some(HevcDepacketizerEvent::AccessUnit(HevcAccessUnit {
            ssrc: self.expected_ssrc,
            rtp_timestamp: timestamp,
            first_sequence_number: current.first_sequence_number,
            last_sequence_number: current.last_sequence_number,
            parameter_set_revision: parameter_sets.revision,
            is_sync,
            bytes,
        }))
    }

    fn commit_parameter_sets(&mut self, nals: &[Vec<u8>]) -> Result<(), HevcDiscontinuity> {
        if nals.iter().any(|nal| {
            matches!(nal_type(nal[0]), NAL_TYPE_VPS | NAL_TYPE_SPS | NAL_TYPE_PPS)
                && nal.len() > self.limits.max_parameter_set_size
        }) {
            return Err(HevcDiscontinuity::ParameterSetTooLarge);
        }

        // Validate every candidate before mutating the committed snapshot. A
        // malformed changed SPS must not combine with new VPS/PPS bytes or
        // replace geometry from the last decoder-ready configuration.
        let mut candidate_video_parameter_set = None;
        let mut candidate_sequence_parameter_set = None;
        let mut candidate_picture_parameter_set = None;
        let mut candidate_pixel_dimensions = None;
        for nal in nals {
            match nal_type(nal[0]) {
                NAL_TYPE_VPS => candidate_video_parameter_set = Some(nal.as_slice()),
                NAL_TYPE_SPS => {
                    candidate_pixel_dimensions = Some(parse_sps_dimensions(nal)?);
                    candidate_sequence_parameter_set = Some(nal.as_slice());
                }
                NAL_TYPE_PPS => candidate_picture_parameter_set = Some(nal.as_slice()),
                _ => {}
            }
        }

        let mut changed = false;
        if let Some(candidate) = candidate_video_parameter_set
            && self.video_parameter_set.as_deref() != Some(candidate)
        {
            self.video_parameter_set = Some(candidate.to_vec());
            changed = true;
        }
        if let Some(candidate) = candidate_sequence_parameter_set {
            if self.sequence_parameter_set.as_deref() != Some(candidate) {
                self.sequence_parameter_set = Some(candidate.to_vec());
                changed = true;
            }
            self.pixel_dimensions = candidate_pixel_dimensions;
        }
        if let Some(candidate) = candidate_picture_parameter_set
            && self.picture_parameter_set.as_deref() != Some(candidate)
        {
            self.picture_parameter_set = Some(candidate.to_vec());
            changed = true;
        }
        if changed
            && self.video_parameter_set.is_some()
            && self.sequence_parameter_set.is_some()
            && self.picture_parameter_set.is_some()
            && self.pixel_dimensions.is_some()
        {
            self.parameter_set_revision = self.parameter_set_revision.saturating_add(1).max(1);
        }
        Ok(())
    }

    fn drop_current_access_unit(&mut self) {
        self.payload_assembler.reset();
        self.current = CurrentAccessUnit::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::rtp::RtpPacket;

    const PAYLOAD_TYPE: u8 = 100;
    const SSRC: u32 = 0x1234_5678;
    const SYNTHETIC_64_X_64_SPS: &[u8] = &[
        0x42, 0x01, 0x01, 0x04, 0x08, 0x00, 0x00, 0x03, 0x00, 0x9f, 0xa8, 0x00, 0x00, 0x03, 0x00,
        0x00, 0xff, 0xa0, 0x20, 0x81, 0x05, 0x96, 0xea, 0x49, 0x32, 0xbc, 0x05, 0xa0, 0x20, 0x00,
        0x00, 0x03, 0x00, 0x20, 0x00, 0x00, 0x03, 0x00, 0x21,
    ];
    const SYNTHETIC_96_X_64_SPS: &[u8] = &[
        0x42, 0x01, 0x01, 0x04, 0x08, 0x00, 0x00, 0x03, 0x00, 0x9f, 0xa8, 0x00, 0x00, 0x03, 0x00,
        0x00, 0xff, 0xa0, 0x30, 0x81, 0x05, 0x96, 0xea, 0x49, 0x32, 0xbc, 0x05, 0xa0, 0x20, 0x00,
        0x00, 0x03, 0x00, 0x20, 0x00, 0x00, 0x03, 0x00, 0x21,
    ];
    const SYNTHETIC_96_X_66_CROPPED_SPS: &[u8] = &[
        0x42, 0x01, 0x01, 0x01, 0x60, 0x00, 0x00, 0x03, 0x00, 0x90, 0x00, 0x00, 0x03, 0x00, 0x00,
        0x03, 0x00, 0x1e, 0xa0, 0x30, 0x81, 0x47, 0xc4, 0x65, 0x95, 0x95, 0x29, 0x30, 0xbc, 0x05,
        0xa0, 0x20, 0x00, 0x00, 0x03, 0x00, 0x20, 0x00, 0x00, 0x03, 0x00, 0x21,
    ];
    // H.265.1 CONFWIN_A_Sony_1, SPS only (ITU conformance bitstream).
    const OFFICIAL_CONFWIN_412_X_236_SPS: &[u8] = &[
        0x42, 0x01, 0x01, 0x21, 0x40, 0x00, 0x00, 0x03, 0x00, 0x10, 0x00, 0x00, 0x03, 0x00, 0x00,
        0x03, 0x00, 0x78, 0xa0, 0x0d, 0x08, 0x0f, 0x1a, 0x49, 0x63, 0x4d, 0x64, 0x93, 0x22, 0x2a,
        0x92, 0xf2, 0xee, 0x05, 0x00, 0x00, 0x1f, 0x48, 0x00, 0x03, 0xa9, 0x80, 0xf8, 0x4e, 0x08,
        0x40, 0x80, 0x00, 0x5b, 0x8d, 0x80, 0x00, 0x2d, 0xc6, 0xc0, 0x00, 0x09, 0x89, 0x68, 0x00,
        0x04, 0xc4, 0xb5, 0x57, 0x08, 0x04, 0x10,
    ];
    // H.265.1 BUMPING_A_ericsson_1, with max_sub_layers_minus1 = 3.
    const OFFICIAL_FOUR_LAYER_416_X_240_SPS: &[u8] = &[
        0x42, 0x01, 0x06, 0x01, 0x60, 0x00, 0x00, 0x03, 0x00, 0x80, 0x00, 0x00, 0x03, 0x00, 0x00,
        0x03, 0x00, 0x5a, 0x00, 0x00, 0xa0, 0x0d, 0x08, 0x0f, 0x16, 0x59, 0xb3, 0x29, 0x9c, 0xc5,
        0xc9, 0x69, 0x17, 0x20, 0x0f, 0xe1, 0x00, 0x82,
    ];

    #[derive(Default)]
    struct TestBitWriter {
        bytes: Vec<u8>,
        bit_count: usize,
    }

    impl TestBitWriter {
        fn bit(&mut self, value: bool) {
            if self.bit_count.is_multiple_of(8) {
                self.bytes.push(0);
            }
            if value {
                let bit_index = 7 - self.bit_count % 8;
                *self.bytes.last_mut().unwrap() |= 1 << bit_index;
            }
            self.bit_count += 1;
        }

        fn bits(&mut self, value: u64, count: usize) {
            for shift in (0..count).rev() {
                self.bit((value >> shift) & 1 != 0);
            }
        }

        fn ue(&mut self, value: u32) {
            let code_num = u64::from(value) + 1;
            let bit_count = (u64::BITS - code_num.leading_zeros()) as usize;
            for _ in 1..bit_count {
                self.bit(false);
            }
            self.bits(code_num, bit_count);
        }

        fn finish(mut self) -> Vec<u8> {
            self.bit(true);
            self.bytes
        }
    }

    fn synthetic_sps_prefix(
        width: u32,
        height: u32,
        chroma_format_idc: u32,
        separate_colour_plane: bool,
        crop: Option<(u32, u32, u32, u32)>,
    ) -> Vec<u8> {
        let mut bits = TestBitWriter::default();
        bits.bits(0, 4); // sps_video_parameter_set_id
        bits.bits(0, 3); // sps_max_sub_layers_minus1
        bits.bit(true); // sps_temporal_id_nesting_flag
        bits.bits(1, 8); // Main profile
        bits.bits(1 << 30, 32); // Main compatibility flag
        bits.bits(0, 48); // general constraint flags
        bits.bits(120, 8); // general_level_idc
        bits.ue(0); // sps_seq_parameter_set_id
        bits.ue(chroma_format_idc);
        if chroma_format_idc == 3 {
            bits.bit(separate_colour_plane);
        }
        bits.ue(width);
        bits.ue(height);
        bits.bit(crop.is_some());
        if let Some((left, right, top, bottom)) = crop {
            bits.ue(left);
            bits.ue(right);
            bits.ue(top);
            bits.ue(bottom);
        }

        let mut nal = vec![NAL_TYPE_SPS << 1, 1];
        nal.extend_from_slice(&encode_test_ebsp(&bits.finish()));
        nal
    }

    fn synthetic_sps_with_sub_layers(
        max_sub_layers_minus1: u8,
        profile_present_mask: u8,
        level_present_mask: u8,
        invalid_reserved_bits: bool,
    ) -> Vec<u8> {
        let mut bits = TestBitWriter::default();
        bits.bits(0, 4);
        bits.bits(u64::from(max_sub_layers_minus1), 3);
        bits.bit(true);
        bits.bits(1, 8);
        bits.bits(1 << 30, 32);
        bits.bits(0, 48);
        bits.bits(120, 8);

        for index in 0..max_sub_layers_minus1 {
            bits.bit(profile_present_mask & (1 << index) != 0);
            bits.bit(level_present_mask & (1 << index) != 0);
        }
        if max_sub_layers_minus1 > 0 {
            for index in max_sub_layers_minus1..8 {
                bits.bits(u64::from(invalid_reserved_bits && index == 7), 2);
            }
        }
        for index in 0..max_sub_layers_minus1 {
            if profile_present_mask & (1 << index) != 0 {
                bits.bits(1, 8);
                bits.bits(1 << 30, 32);
                bits.bits(0, 48);
            }
            if level_present_mask & (1 << index) != 0 {
                bits.bits(120, 8);
            }
        }

        bits.ue(0);
        bits.ue(1);
        bits.ue(320);
        bits.ue(180);
        bits.bit(false);
        let mut nal = vec![NAL_TYPE_SPS << 1, 1];
        nal.extend_from_slice(&encode_test_ebsp(&bits.finish()));
        nal
    }

    fn encode_test_ebsp(rbsp: &[u8]) -> Vec<u8> {
        let mut ebsp = Vec::with_capacity(rbsp.len());
        let mut consecutive_zero_bytes = 0usize;
        for &byte in rbsp {
            if consecutive_zero_bytes == 2 && byte <= 0x03 {
                ebsp.push(0x03);
                consecutive_zero_bytes = 0;
            }
            ebsp.push(byte);
            consecutive_zero_bytes = if byte == 0 {
                consecutive_zero_bytes + 1
            } else {
                0
            };
        }
        ebsp
    }

    fn nal(nal_type: u8, body: &[u8]) -> Vec<u8> {
        let mut nal = vec![nal_type << 1, 1];
        nal.extend_from_slice(body);
        nal
    }

    fn ap(nals: &[Vec<u8>]) -> Vec<u8> {
        let mut payload = vec![NAL_TYPE_AP << 1, 1];
        for nal in nals {
            payload.extend_from_slice(&(nal.len() as u16).to_be_bytes());
            payload.extend_from_slice(nal);
        }
        payload
    }

    fn fu(nal_type: u8, start: bool, end: bool, fragment: &[u8]) -> Vec<u8> {
        let mut payload = vec![NAL_TYPE_FU << 1, 1];
        payload.push((u8::from(start) << 7) | (u8::from(end) << 6) | nal_type);
        payload.extend_from_slice(fragment);
        payload
    }

    fn packet<'a>(
        payload_type: u8,
        ssrc: u32,
        sequence_number: u16,
        timestamp: u32,
        marker: bool,
        payload: &'a [u8],
    ) -> RtpPacket<'a> {
        RtpPacket {
            version: 2,
            padding: false,
            extension: false,
            marker,
            payload_type,
            sequence_number,
            timestamp,
            ssrc,
            csrc: Vec::new(),
            ext_profile: 0,
            ext_data: &[],
            payload,
        }
    }

    fn push(
        assembler: &mut HevcAccessUnitAssembler,
        sequence_number: u16,
        timestamp: u32,
        marker: bool,
        payload: &[u8],
    ) -> Vec<HevcDepacketizerEvent> {
        assembler.push_packet(&packet(
            PAYLOAD_TYPE,
            SSRC,
            sequence_number,
            timestamp,
            marker,
            payload,
        ))
    }

    fn synchronize(assembler: &mut HevcAccessUnitAssembler, sequence_number: u16) {
        let boundary = nal(39, &[0xaa]);
        assert!(
            push(assembler, sequence_number, 1, true, &boundary).is_empty(),
            "the startup access unit must be discarded"
        );
    }

    fn prime_parameter_sets(
        assembler: &mut HevcAccessUnitAssembler,
        sequence_number: u16,
    ) -> HevcParameterSets {
        let parameters = ap(&[
            nal(NAL_TYPE_VPS, &[0x10]),
            SYNTHETIC_64_X_64_SPS.to_vec(),
            nal(NAL_TYPE_PPS, &[0x30]),
        ]);
        let events = push(assembler, sequence_number, 2, true, &parameters);
        assert!(
            events.is_empty(),
            "a parameter-set-only access unit is not a decodable sample: {events:?}"
        );
        assembler
            .parameter_sets()
            .expect("all three parameter sets should be committed")
    }

    fn access_units(events: Vec<HevcDepacketizerEvent>) -> Vec<HevcAccessUnit> {
        events
            .into_iter()
            .filter_map(|event| match event {
                HevcDepacketizerEvent::AccessUnit(access_unit) => Some(access_unit),
                _ => None,
            })
            .collect()
    }

    fn has_discontinuity(events: &[HevcDepacketizerEvent], expected: HevcDiscontinuity) -> bool {
        events.iter().any(
            |event| matches!(event, HevcDepacketizerEvent::Discontinuity(actual) if *actual == expected),
        )
    }

    fn length_prefixed(nals: &[Vec<u8>]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for nal in nals {
            bytes.extend_from_slice(&(nal.len() as u32).to_be_bytes());
            bytes.extend_from_slice(nal);
        }
        bytes
    }

    #[test]
    fn accepts_the_complete_initial_access_unit_from_a_new_stream_epoch() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        let vps = nal(NAL_TYPE_VPS, &[0x10]);
        let sps = SYNTHETIC_64_X_64_SPS.to_vec();
        let pps = nal(NAL_TYPE_PPS, &[0x30]);
        let sync_sample = nal(19, &[0x80]);
        let initial_access_unit = ap(&[vps.clone(), sps.clone(), pps.clone(), sync_sample.clone()]);

        let output = access_units(push(&mut assembler, 1, 1, true, &initial_access_unit));

        assert_eq!(output.len(), 1);
        assert!(output[0].is_sync);
        assert_eq!(
            output[0].bytes,
            length_prefixed(&[vps, sps, pps, sync_sample])
        );
        let configuration = assembler
            .parameter_sets()
            .expect("the initial access unit carries decoder configuration");
        assert_eq!(
            (configuration.pixel_width, configuration.pixel_height),
            (64, 64)
        );
    }

    #[test]
    fn accepts_a_fragmented_decoder_ready_initial_access_unit() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        let vps = nal(NAL_TYPE_VPS, &[0x10]);
        let sps = SYNTHETIC_64_X_64_SPS.to_vec();
        let pps = nal(NAL_TYPE_PPS, &[0x30]);
        let parameters = ap(&[vps.clone(), sps.clone(), pps.clone()]);
        let sync_start = fu(19, true, false, &[0x80, 0x50]);
        let sync_end = fu(19, false, true, &[0x51]);

        assert!(push(&mut assembler, 1, 1, false, &parameters).is_empty());
        assert!(push(&mut assembler, 2, 1, false, &sync_start).is_empty());
        let output = access_units(push(&mut assembler, 3, 1, true, &sync_end));

        assert_eq!(output.len(), 1);
        assert!(output[0].is_sync);
        assert_eq!(
            output[0].bytes,
            length_prefixed(&[vps, sps, pps, nal(19, &[0x80, 0x50, 0x51])])
        );
        let configuration = assembler
            .parameter_sets()
            .expect("the fragmented initial access unit carries decoder configuration");
        assert_eq!(
            (configuration.pixel_width, configuration.pixel_height),
            (64, 64)
        );
    }

    #[test]
    fn discards_a_multi_packet_initial_access_unit_without_decoder_configuration() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        let partial = nal(39, &[0x40]);
        let sync_sample = nal(19, &[0xD0]);

        assert!(push(&mut assembler, 1, 1, false, &partial).is_empty());
        assert!(
            access_units(push(&mut assembler, 2, 1, true, &sync_sample)).is_empty(),
            "an initial access unit without decoder configuration must be discarded"
        );
        assert!(
            assembler.parameter_sets().is_none(),
            "discarded startup bytes must not configure the decoder"
        );

        let complete = ap(&[
            nal(NAL_TYPE_VPS, &[0x10]),
            SYNTHETIC_64_X_64_SPS.to_vec(),
            nal(NAL_TYPE_PPS, &[0x30]),
            sync_sample,
        ]);
        assert_eq!(
            access_units(push(&mut assembler, 3, 2, true, &complete)).len(),
            1,
            "the next complete access unit after the marker boundary should be emitted"
        );
    }

    #[test]
    fn parses_dimensions_from_generated_and_official_conformance_sps_fixtures() {
        assert_eq!(parse_sps_dimensions(SYNTHETIC_64_X_64_SPS), Ok((64, 64)));
        assert_eq!(parse_sps_dimensions(SYNTHETIC_96_X_64_SPS), Ok((96, 64)));
        assert_eq!(
            parse_sps_dimensions(SYNTHETIC_96_X_66_CROPPED_SPS),
            Ok((96, 66))
        );
        assert_eq!(
            parse_sps_dimensions(OFFICIAL_CONFWIN_412_X_236_SPS),
            Ok((412, 236))
        );
        assert_eq!(
            parse_sps_dimensions(OFFICIAL_FOUR_LAYER_416_X_240_SPS),
            Ok((416, 240))
        );
    }

    #[test]
    fn parses_the_dimension_prefix_fields_at_the_normative_bit_offsets() {
        let rbsp =
            decode_rbsp(&SYNTHETIC_64_X_64_SPS[HEVC_NAL_HEADER_LEN..]).expect("valid SPS EBSP");
        let mut bits = BitReader::new(&rbsp);
        assert_eq!(bits.read_bits(4), Ok(0));
        assert_eq!(bits.read_bits(3), Ok(0));
        assert_eq!(bits.read_bit(), Ok(true));
        assert_eq!(skip_profile_tier_level(&mut bits, 0), Ok(()));
        assert_eq!(bits.read_ue(), Ok(0));
        assert_eq!(bits.read_ue(), Ok(1));
        assert_eq!(bits.read_ue(), Ok(64));
        assert_eq!(bits.read_ue(), Ok(64));
        assert_eq!(bits.read_bit(), Ok(false));
    }

    #[test]
    fn skips_mixed_profile_tier_level_data_through_six_sub_layers() {
        let mixed = synthetic_sps_with_sub_layers(6, 0b01_0101, 0b10_1010, false);
        assert_eq!(parse_sps_dimensions(&mixed), Ok((320, 180)));

        let invalid_reserved = synthetic_sps_with_sub_layers(3, 0, 0, true);
        assert_eq!(
            parse_sps_dimensions(&invalid_reserved),
            Err(HevcDiscontinuity::MalformedPayload)
        );
    }

    #[test]
    fn applies_conformance_window_crop_units_for_every_chroma_format() {
        let cases = [
            (0, false, (97, 73)),
            (1, false, (94, 66)),
            (2, false, (94, 73)),
            (3, false, (97, 73)),
            (3, true, (97, 73)),
        ];

        for (chroma_format_idc, separate_colour_plane, expected) in cases {
            let sps = synthetic_sps_prefix(
                100,
                80,
                chroma_format_idc,
                separate_colour_plane,
                Some((1, 2, 3, 4)),
            );
            assert_eq!(
                parse_sps_dimensions(&sps),
                Ok(expected),
                "wrong crop units for chroma_format_idc={chroma_format_idc}, \
                 separate_colour_plane={separate_colour_plane}"
            );
        }
    }

    #[test]
    fn rejects_malformed_or_impossible_sps_dimension_prefixes() {
        let malformed_escape = {
            let mut sps = SYNTHETIC_64_X_64_SPS.to_vec();
            let escape = sps
                .windows(4)
                .position(|bytes| bytes == [0, 0, 3, 0])
                .expect("fixture contains an emulation-prevention byte");
            sps[escape + 3] = 4;
            sps
        };
        let unescaped_start_code = {
            let mut sps = SYNTHETIC_64_X_64_SPS.to_vec();
            let escape = sps
                .windows(4)
                .position(|bytes| bytes == [0, 0, 3, 0])
                .expect("fixture contains an emulation-prevention byte");
            sps.remove(escape + 2);
            sps
        };
        let invalid_chroma = synthetic_sps_prefix(100, 80, 4, false, None);
        let impossible_crop = synthetic_sps_prefix(4, 4, 1, false, Some((2, 1, 0, 0)));
        let invalid_sub_layers = {
            let mut sps = synthetic_sps_prefix(100, 80, 1, false, None);
            sps[2] = 0x0f;
            sps
        };
        let wrong_nal_type = {
            let mut sps = SYNTHETIC_64_X_64_SPS.to_vec();
            sps[0] = NAL_TYPE_VPS << 1;
            sps
        };
        let invalid_temporal_id = {
            let mut sps = SYNTHETIC_64_X_64_SPS.to_vec();
            sps[1] &= !0x07;
            sps
        };
        let non_base_layer = {
            let mut sps = SYNTHETIC_64_X_64_SPS.to_vec();
            sps[1] |= 0x08;
            sps
        };
        let temporal_id_two = {
            let mut sps = SYNTHETIC_64_X_64_SPS.to_vec();
            sps[1] = (sps[1] & !0x07) | 2;
            sps
        };
        let trailing_zero = {
            let mut sps = SYNTHETIC_64_X_64_SPS.to_vec();
            sps.push(0);
            sps
        };
        let dimension_too_large =
            synthetic_sps_prefix(MAX_CODED_PIXEL_DIMENSION + 1, 1, 0, false, None);
        let pixel_count_too_large =
            synthetic_sps_prefix(MAX_CODED_PIXEL_DIMENSION, 8_193, 0, false, None);

        for malformed in [
            Vec::new(),
            vec![NAL_TYPE_SPS << 1, 1],
            SYNTHETIC_64_X_64_SPS[..18].to_vec(),
            malformed_escape,
            unescaped_start_code,
            invalid_chroma,
            impossible_crop,
            invalid_sub_layers,
            wrong_nal_type,
            invalid_temporal_id,
            non_base_layer,
            temporal_id_two,
            trailing_zero,
            dimension_too_large,
            pixel_count_too_large,
        ] {
            assert_eq!(
                parse_sps_dimensions(&malformed),
                Err(HevcDiscontinuity::MalformedPayload)
            );
        }
    }

    #[test]
    fn rbsp_decoder_accepts_a_terminal_emulation_prevention_byte() {
        assert_eq!(decode_rbsp(&[0, 0, 3]), Ok(vec![0, 0]));
    }

    #[test]
    fn exp_golomb_reader_accepts_u32_max_and_rejects_longer_codes() {
        let maximum = [0, 0, 0, 0, 0x80, 0, 0, 0, 0];
        assert_eq!(BitReader::new(&maximum).read_ue(), Ok(u32::MAX));

        let overlong = [0, 0, 0, 0, 0x40, 0, 0, 0, 0];
        assert_eq!(
            BitReader::new(&overlong).read_ue(),
            Err(HevcDiscontinuity::MalformedPayload)
        );
    }

    #[test]
    fn sps_dimension_parser_is_bounded_and_panic_free_for_arbitrary_bytes() {
        let oversized = vec![0; MAX_PARAMETER_SET_SIZE + 1];
        assert_eq!(
            parse_sps_dimensions(&oversized),
            Err(HevcDiscontinuity::ParameterSetTooLarge)
        );

        let mut state = 0x9af3_71cdu32;
        for length in 0..=512 {
            let mut sps = vec![0; length];
            for byte in &mut sps {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                *byte = state as u8;
            }
            if sps.len() >= HEVC_NAL_HEADER_LEN {
                sps[0] = NAL_TYPE_SPS << 1;
                sps[1] = 1;
            }
            if let Ok((width, height)) = parse_sps_dimensions(&sps) {
                assert!(width > 0);
                assert!(height > 0);
            }
        }
    }

    #[test]
    fn commits_sps_dimensions_atomically_with_parameter_set_revision() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 5);
        let initial = ap(&[
            nal(NAL_TYPE_VPS, &[0x10]),
            SYNTHETIC_64_X_64_SPS.to_vec(),
            nal(NAL_TYPE_PPS, &[0x30]),
        ]);
        assert!(push(&mut assembler, 6, 2, true, &initial).is_empty());
        let first = assembler.parameter_sets().expect("complete configuration");
        assert_eq!((first.pixel_width, first.pixel_height), (64, 64));
        assert_eq!(first.revision, 1);

        let changed = ap(&[
            nal(NAL_TYPE_VPS, &[0x10]),
            SYNTHETIC_96_X_64_SPS.to_vec(),
            nal(NAL_TYPE_PPS, &[0x30]),
        ]);
        assert!(push(&mut assembler, 7, 3, true, &changed).is_empty());
        let second = assembler.parameter_sets().expect("changed configuration");
        assert_eq!((second.pixel_width, second.pixel_height), (96, 64));
        assert_eq!(second.revision, 2);

        let malformed_sps = synthetic_sps_prefix(4, 4, 1, false, Some((2, 1, 0, 0)));
        let rejected = ap(&[
            nal(NAL_TYPE_VPS, &[0x11]),
            malformed_sps,
            nal(NAL_TYPE_PPS, &[0x31]),
        ]);
        let events = push(&mut assembler, 8, 4, true, &rejected);
        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::MalformedPayload
        ));
        assert_eq!(
            assembler.parameter_sets().expect("prior configuration"),
            second
        );
    }

    #[test]
    fn emits_only_complete_marker_closed_length_prefixed_access_units() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 10);
        let parameters = prime_parameter_sets(&mut assembler, 11);

        let prefix = nal(39, &[0x40]);
        let slice = nal(19, &[0xD0, 0x51]);
        assert!(push(&mut assembler, 12, 3, false, &prefix).is_empty());
        let output = access_units(push(&mut assembler, 13, 3, true, &slice));

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].rtp_timestamp, 3);
        assert_eq!(output[0].first_sequence_number, 12);
        assert_eq!(output[0].last_sequence_number, 13);
        assert_eq!(output[0].ssrc, SSRC);
        assert!(output[0].is_sync);
        assert_eq!(output[0].parameter_set_revision, parameters.revision);
        assert_eq!(output[0].bytes, length_prefixed(&[prefix, slice]));
    }

    #[test]
    fn reassembles_fu_and_removes_the_exact_displayservice_slice_trailer() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 20);
        prime_parameter_sets(&mut assembler, 21);

        let first = fu(19, true, false, &[0xaa, 0xbb]);
        let middle = fu(19, false, false, &[0xcc]);
        let mut last_fragment = vec![0xdd];
        last_fragment.extend_from_slice(&DISPLAYSERVICE_NAL_TRAILER);
        let last = fu(19, false, true, &last_fragment);
        assert!(push(&mut assembler, 22, 4, false, &first).is_empty());
        assert!(push(&mut assembler, 23, 4, false, &middle).is_empty());
        let output = access_units(push(&mut assembler, 24, 4, true, &last));

        assert_eq!(output.len(), 1);
        assert_eq!(
            output[0].bytes,
            length_prefixed(&[nal(19, &[0xaa, 0xbb, 0xcc, 0xdd])])
        );
    }

    #[test]
    fn a_slice_containing_only_the_displayservice_trailer_is_malformed() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 25);
        prime_parameter_sets(&mut assembler, 26);

        let mut invalid = vec![1 << 1, 1];
        invalid.extend_from_slice(&DISPLAYSERVICE_NAL_TRAILER);
        let events = push(&mut assembler, 27, 5, true, &invalid);

        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::MalformedPayload
        ));
        assert!(access_units(events).is_empty());
    }

    #[test]
    fn reorders_packets_across_sequence_wrap_without_reordering_nals() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 65_532);
        prime_parameter_sets(&mut assembler, 65_533);

        let first = nal(19, &[0x81]);
        let second = nal(19, &[2]);
        assert!(push(&mut assembler, 65_535, 5, true, &second).is_empty());
        let output = access_units(push(&mut assembler, 65_534, 5, false, &first));
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].bytes, length_prefixed(&[first, second]));

        let wrapped = nal(1, &[3]);
        let output = access_units(push(&mut assembler, 0, 6, true, &wrapped));
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].first_sequence_number, 0);
    }

    #[test]
    fn malformed_ap_is_atomic_and_cannot_poison_parameter_sets() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 30);

        let first = nal(NAL_TYPE_VPS, &[1]);
        let mut malformed = vec![NAL_TYPE_AP << 1, 1];
        malformed.extend_from_slice(&(first.len() as u16).to_be_bytes());
        malformed.extend_from_slice(&first);
        malformed.extend_from_slice(&10u16.to_be_bytes());
        malformed.extend_from_slice(&[NAL_TYPE_SPS << 1, 1]);
        let events = push(&mut assembler, 31, 2, true, &malformed);

        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::MalformedPayload
        ));
        assert!(assembler.parameter_sets().is_none());

        let parameters = prime_parameter_sets(&mut assembler, 32);
        assert_eq!(parameters.revision, 1);
    }

    #[test]
    fn sequence_gap_drops_predicted_frames_until_a_fresh_sync_sample() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 40);
        prime_parameter_sets(&mut assembler, 41);

        let partial = nal(1, &[0xaa]);
        assert!(push(&mut assembler, 42, 10, false, &partial).is_empty());
        let buffered = nal(1, &[0xbb]);
        let mut observed_gap = false;
        for offset in 0..=MAX_REORDER_BUFFER {
            let marker = offset == MAX_REORDER_BUFFER;
            let events = push(
                &mut assembler,
                44u16.wrapping_add(offset as u16),
                11,
                marker,
                &buffered,
            );
            observed_gap |= has_discontinuity(&events, HevcDiscontinuity::SequenceGap);
            assert!(access_units(events).is_empty());
        }
        assert!(observed_gap);

        let first_sequence_after_gap = 44u16.wrapping_add(MAX_REORDER_BUFFER as u16 + 1);
        let predicted = nal(1, &[0xcc]);
        assert!(
            access_units(push(
                &mut assembler,
                first_sequence_after_gap,
                12,
                true,
                &predicted,
            ))
            .is_empty(),
            "a predicted frame with invalid references must not reach the decoder"
        );

        let recovered = nal(19, &[0xdd]);
        let output = access_units(push(
            &mut assembler,
            first_sequence_after_gap.wrapping_add(1),
            13,
            true,
            &recovered,
        ));
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].bytes, length_prefixed(&[recovered]));
    }

    #[test]
    fn reorder_byte_limit_recovers_without_emitting_buffered_partial_data() {
        let limits = DepacketizerLimits {
            max_reorder_bytes: 8,
            ..DepacketizerLimits::default()
        };
        let mut assembler = HevcAccessUnitAssembler::with_limits(PAYLOAD_TYPE, SSRC, limits);
        synchronize(&mut assembler, 50);
        prime_parameter_sets(&mut assembler, 51);

        let buffered = nal(1, &[1, 2, 3, 4]);
        assert!(push(&mut assembler, 53, 10, false, &buffered).is_empty());
        let events = push(&mut assembler, 54, 10, true, &buffered);
        assert!(has_discontinuity(&events, HevcDiscontinuity::SequenceGap));
        assert!(access_units(events).is_empty());

        let recovered = nal(19, &[0x85]);
        let output = access_units(push(&mut assembler, 55, 11, true, &recovered));
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].bytes, length_prefixed(&[recovered]));
    }

    #[test]
    fn timestamp_change_without_marker_requires_a_fresh_sync_sample() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 60);
        prime_parameter_sets(&mut assembler, 61);

        assert!(
            push(&mut assembler, 62, 20, false, &nal(1, &[1])).is_empty(),
            "an open access unit must not escape"
        );
        let predicted = nal(1, &[2]);
        let events = push(&mut assembler, 63, 21, true, &predicted);
        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::TimestampChangedWithoutMarker
        ));
        assert!(access_units(events).is_empty());

        let recovered = nal(19, &[0x82]);
        let output = access_units(push(&mut assembler, 64, 22, true, &recovered));
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].bytes, length_prefixed(&[recovered]));
    }

    #[test]
    fn rejects_invalid_fu_and_reserved_payload_structures() {
        let invalid_payloads = [
            fu(1, true, true, &[1]),
            fu(1, false, true, &[1]),
            fu(1, true, false, &[]),
            vec![50 << 1, 1, 0],
            vec![1 << 1, 0, 1],
        ];

        for (index, invalid) in invalid_payloads.iter().enumerate() {
            let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
            synchronize(&mut assembler, 100 + index as u16 * 2);
            let events = push(&mut assembler, 101 + index as u16 * 2, 30, true, invalid);
            assert!(
                has_discontinuity(&events, HevcDiscontinuity::MalformedPayload),
                "invalid case {index} was accepted"
            );
            assert!(access_units(events).is_empty());
        }
    }

    #[test]
    fn rejects_incomplete_or_inconsistent_fu_chains_as_whole_access_units() {
        let cases = [
            (fu(1, true, false, &[1]), fu(2, false, true, &[2]), false),
            (
                fu(1, true, false, &[1]),
                {
                    let mut changed_layer = fu(1, false, true, &[2]);
                    changed_layer[1] = 9;
                    changed_layer
                },
                false,
            ),
            (fu(1, true, false, &[1]), fu(1, true, false, &[2]), false),
            (fu(1, true, false, &[1]), fu(1, false, true, &[2]), true),
        ];

        for (index, (first, second, first_has_marker)) in cases.into_iter().enumerate() {
            let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
            let base = 150 + index as u16 * 4;
            synchronize(&mut assembler, base);
            prime_parameter_sets(&mut assembler, base + 1);

            let first_events = push(&mut assembler, base + 2, 31, first_has_marker, &first);
            let mut events = first_events;
            if !first_has_marker {
                events.extend(push(&mut assembler, base + 3, 31, true, &second));
            }

            assert!(
                has_discontinuity(&events, HevcDiscontinuity::MalformedPayload),
                "inconsistent FU case {index} was accepted"
            );
            assert!(access_units(events).is_empty());
        }
    }

    #[test]
    fn enforces_nal_access_unit_and_nal_count_limits() {
        let nal_limits = DepacketizerLimits {
            max_nal_unit_size: SYNTHETIC_64_X_64_SPS.len(),
            max_nal_unit_count: 4,
            ..DepacketizerLimits::default()
        };
        let mut assembler = HevcAccessUnitAssembler::with_limits(PAYLOAD_TYPE, SSRC, nal_limits);
        synchronize(&mut assembler, 200);
        prime_parameter_sets(&mut assembler, 201);

        let oversized_body = vec![0; SYNTHETIC_64_X_64_SPS.len() - 1];
        let oversized_nal = nal(1, &oversized_body);
        let events = push(&mut assembler, 202, 40, true, &oversized_nal);
        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::NalUnitTooLarge
        ));

        let too_many = ap(&[
            nal(1, &[1]),
            nal(1, &[2]),
            nal(1, &[3]),
            nal(1, &[4]),
            nal(1, &[5]),
        ]);
        let events = push(&mut assembler, 203, 41, true, &too_many);
        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::TooManyNalUnits
        ));

        let access_unit_limits = DepacketizerLimits {
            max_access_unit_size: 24,
            ..DepacketizerLimits::default()
        };
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 300);
        prime_parameter_sets(&mut assembler, 301);
        assembler.limits = access_unit_limits;
        let first = nal(1, &[1, 2, 3, 4]);
        let second = nal(1, &[5, 6, 7, 8]);
        let third = nal(1, &[9, 10, 11, 12]);
        assert!(push(&mut assembler, 302, 42, false, &first).is_empty());
        assert!(push(&mut assembler, 303, 42, false, &second).is_empty());
        let events = push(&mut assembler, 304, 42, true, &third);
        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::AccessUnitTooLarge
        ));
        assert!(access_units(events).is_empty());

        let parameter_limits = DepacketizerLimits {
            max_parameter_set_size: SYNTHETIC_64_X_64_SPS.len(),
            ..DepacketizerLimits::default()
        };
        let mut assembler =
            HevcAccessUnitAssembler::with_limits(PAYLOAD_TYPE, SSRC, parameter_limits);
        synchronize(&mut assembler, 400);
        let original = prime_parameter_sets(&mut assembler, 401);
        let mut oversized_sps = SYNTHETIC_64_X_64_SPS.to_vec();
        oversized_sps.push(0);
        let oversized_parameter_set = ap(&[oversized_sps, nal(NAL_TYPE_PPS, &[0x30])]);
        let events = push(&mut assembler, 402, 43, true, &oversized_parameter_set);
        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::ParameterSetTooLarge
        ));
        assert_eq!(assembler.parameter_sets().unwrap(), original);
    }

    #[test]
    fn reset_is_a_cancellation_barrier_for_partial_and_buffered_data() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 300);
        prime_parameter_sets(&mut assembler, 301);
        assert!(push(&mut assembler, 302, 50, false, &fu(1, true, false, &[1])).is_empty());
        assert!(push(&mut assembler, 304, 50, true, &fu(1, false, true, &[3])).is_empty());

        assembler.reset();
        assert!(assembler.parameter_sets().is_none());
        let events = push(&mut assembler, 303, 50, true, &fu(1, false, true, &[2]));
        assert!(has_discontinuity(
            &events,
            HevcDiscontinuity::MalformedPayload
        ));
        assert!(access_units(events).is_empty());
        assert!(
            push(&mut assembler, 304, 51, true, &nal(1, &[4])).is_empty(),
            "predicted frames must remain gated after reset"
        );

        prime_parameter_sets(&mut assembler, 305);
        let recovered = nal(19, &[0x85]);
        assert_eq!(
            access_units(push(&mut assembler, 306, 52, true, &recovered)).len(),
            1
        );
    }

    #[test]
    fn rejects_packets_outside_the_negotiated_payload_and_source() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        let payload = nal(1, &[1]);

        let events = assembler.push_packet(&packet(99, SSRC, 1, 1, true, &payload));
        assert_eq!(
            events,
            vec![HevcDepacketizerEvent::PacketRejected(
                HevcPacketRejection::UnexpectedPayloadType
            )]
        );
        let events = assembler.push_packet(&packet(PAYLOAD_TYPE, SSRC + 1, 1, 1, true, &payload));
        assert_eq!(
            events,
            vec![HevcDepacketizerEvent::PacketRejected(
                HevcPacketRejection::UnexpectedSource
            )]
        );

        synchronize(&mut assembler, 1);
    }

    #[test]
    fn parameter_set_revision_changes_only_when_committed_bytes_change() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 400);
        let first = prime_parameter_sets(&mut assembler, 401);
        assert_eq!(first.revision, 1);

        let identical = ap(&[
            nal(NAL_TYPE_VPS, &[0x10]),
            SYNTHETIC_64_X_64_SPS.to_vec(),
            nal(NAL_TYPE_PPS, &[0x30]),
        ]);
        assert!(push(&mut assembler, 402, 2, true, &identical).is_empty());
        assert_eq!(assembler.parameter_sets().unwrap().revision, 1);

        let changed = ap(&[
            nal(NAL_TYPE_VPS, &[0x10]),
            SYNTHETIC_96_X_64_SPS.to_vec(),
            nal(NAL_TYPE_PPS, &[0x30]),
        ]);
        assert!(push(&mut assembler, 403, 3, true, &changed).is_empty());
        assert_eq!(assembler.parameter_sets().unwrap().revision, 2);
    }

    #[test]
    fn duplicate_and_late_packets_never_duplicate_access_unit_bytes() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 500);
        prime_parameter_sets(&mut assembler, 501);

        let sample = nal(19, &[0x81]);
        let output = access_units(push(&mut assembler, 502, 4, true, &sample));
        assert_eq!(output.len(), 1);
        assert!(push(&mut assembler, 502, 4, true, &sample).is_empty());
        assert!(push(&mut assembler, 501, 2, true, &sample).is_empty());
    }

    #[test]
    fn payload_parser_is_bounded_and_panic_free_for_arbitrary_bytes() {
        let mut state = 0x51a7_9e3du32;
        for length in 0..=512 {
            let mut bytes = vec![0; length];
            for byte in &mut bytes {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                *byte = state as u8;
            }

            let mut assembler = PayloadAssembler::new(128, 8);
            if let Ok(nals) = assembler.process(1, &bytes) {
                assert!(nals.len() <= 8);
                assert!(nals.iter().all(|nal| nal.len() <= 128));
            }
        }
    }

}
