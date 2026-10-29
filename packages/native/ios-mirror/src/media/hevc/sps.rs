use super::{
    HEVC_NAL_HEADER_LEN, HevcDiscontinuity, MAX_PARAMETER_SET_SIZE, NAL_TYPE_SPS, nal_type,
    validate_payload_header,
};

const MAX_CODED_PIXEL_DIMENSION: u32 = 16_384;
const MAX_CODED_PIXEL_COUNT: u64 = 128 * 1024 * 1024;

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
pub(super) fn parse_sps_dimensions(sps: &[u8]) -> Result<(u32, u32), HevcDiscontinuity> {
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

#[cfg(test)]
#[path = "sps_tests.rs"]
mod tests;
