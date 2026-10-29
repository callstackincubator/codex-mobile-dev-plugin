use super::{
    HEVC_NAL_HEADER_LEN, HevcDiscontinuity, NAL_TYPE_AP, NAL_TYPE_FU, is_vcl, nal_type,
    validate_payload_header,
};

// Apple's DisplayService appends this exact non-HEVC trailer to coded-slice
// NAL units. `avconferenced` strips it before decode. Match the complete suffix
// only, and only on VCL NAL units, so conforming streams are unchanged.
pub(super) const DISPLAYSERVICE_NAL_TRAILER: [u8; 14] = [
    0x04, 0xf0, 0x0a, 0xc0, 0x00, 0x00, 0x03, 0x00, 0x00, 0x04, 0xec, 0x0a, 0xb0, 0x03,
];

#[derive(Debug)]
struct FragmentedNal {
    timestamp: u32,
    payload_header_masked: u8,
    payload_header_second: u8,
    nal_type: u8,
    bytes: Vec<u8>,
}

/// Turns ordered RFC 7798 payloads into complete NAL units, keeping at most one
/// fragmentation unit open.
#[derive(Debug)]
pub(super) struct PayloadAssembler {
    fragmented_nal: Option<FragmentedNal>,
    max_nal_unit_size: usize,
    max_nal_unit_count: usize,
}

impl PayloadAssembler {
    pub(super) fn new(max_nal_unit_size: usize, max_nal_unit_count: usize) -> Self {
        Self {
            fragmented_nal: None,
            max_nal_unit_size,
            max_nal_unit_count,
        }
    }

    pub(super) fn reset(&mut self) {
        self.fragmented_nal = None;
    }

    pub(super) fn has_fragmented_nal(&self) -> bool {
        self.fragmented_nal.is_some()
    }

    pub(super) fn process(
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

#[cfg(test)]
#[path = "payload_tests.rs"]
mod tests;
