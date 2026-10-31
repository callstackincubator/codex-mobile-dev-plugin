//! Fixtures and packet builders shared by the HEVC module tests.

use super::{
    HevcAccessUnit, HevcAccessUnitAssembler, HevcDepacketizerEvent, HevcDiscontinuity,
    HevcParameterSets, NAL_TYPE_AP, NAL_TYPE_FU, NAL_TYPE_PPS, NAL_TYPE_SPS, NAL_TYPE_VPS,
};
use crate::media::rtp::RtpPacket;

pub(super) const PAYLOAD_TYPE: u8 = 100;
pub(super) const SSRC: u32 = 0x1234_5678;
pub(super) const SYNTHETIC_64_X_64_SPS: &[u8] = &[
    0x42, 0x01, 0x01, 0x04, 0x08, 0x00, 0x00, 0x03, 0x00, 0x9f, 0xa8, 0x00, 0x00, 0x03, 0x00,
    0x00, 0xff, 0xa0, 0x20, 0x81, 0x05, 0x96, 0xea, 0x49, 0x32, 0xbc, 0x05, 0xa0, 0x20, 0x00,
    0x00, 0x03, 0x00, 0x20, 0x00, 0x00, 0x03, 0x00, 0x21,
];
pub(super) const SYNTHETIC_96_X_64_SPS: &[u8] = &[
    0x42, 0x01, 0x01, 0x04, 0x08, 0x00, 0x00, 0x03, 0x00, 0x9f, 0xa8, 0x00, 0x00, 0x03, 0x00,
    0x00, 0xff, 0xa0, 0x30, 0x81, 0x05, 0x96, 0xea, 0x49, 0x32, 0xbc, 0x05, 0xa0, 0x20, 0x00,
    0x00, 0x03, 0x00, 0x20, 0x00, 0x00, 0x03, 0x00, 0x21,
];
pub(super) const SYNTHETIC_96_X_66_CROPPED_SPS: &[u8] = &[
    0x42, 0x01, 0x01, 0x01, 0x60, 0x00, 0x00, 0x03, 0x00, 0x90, 0x00, 0x00, 0x03, 0x00, 0x00,
    0x03, 0x00, 0x1e, 0xa0, 0x30, 0x81, 0x47, 0xc4, 0x65, 0x95, 0x95, 0x29, 0x30, 0xbc, 0x05,
    0xa0, 0x20, 0x00, 0x00, 0x03, 0x00, 0x20, 0x00, 0x00, 0x03, 0x00, 0x21,
];
// H.265.1 CONFWIN_A_Sony_1, SPS only (ITU conformance bitstream).
pub(super) const OFFICIAL_CONFWIN_412_X_236_SPS: &[u8] = &[
    0x42, 0x01, 0x01, 0x21, 0x40, 0x00, 0x00, 0x03, 0x00, 0x10, 0x00, 0x00, 0x03, 0x00, 0x00,
    0x03, 0x00, 0x78, 0xa0, 0x0d, 0x08, 0x0f, 0x1a, 0x49, 0x63, 0x4d, 0x64, 0x93, 0x22, 0x2a,
    0x92, 0xf2, 0xee, 0x05, 0x00, 0x00, 0x1f, 0x48, 0x00, 0x03, 0xa9, 0x80, 0xf8, 0x4e, 0x08,
    0x40, 0x80, 0x00, 0x5b, 0x8d, 0x80, 0x00, 0x2d, 0xc6, 0xc0, 0x00, 0x09, 0x89, 0x68, 0x00,
    0x04, 0xc4, 0xb5, 0x57, 0x08, 0x04, 0x10,
];
// H.265.1 BUMPING_A_ericsson_1, with max_sub_layers_minus1 = 3.
pub(super) const OFFICIAL_FOUR_LAYER_416_X_240_SPS: &[u8] = &[
    0x42, 0x01, 0x06, 0x01, 0x60, 0x00, 0x00, 0x03, 0x00, 0x80, 0x00, 0x00, 0x03, 0x00, 0x00,
    0x03, 0x00, 0x5a, 0x00, 0x00, 0xa0, 0x0d, 0x08, 0x0f, 0x16, 0x59, 0xb3, 0x29, 0x9c, 0xc5,
    0xc9, 0x69, 0x17, 0x20, 0x0f, 0xe1, 0x00, 0x82,
];

#[derive(Default)]
pub(super) struct TestBitWriter {
    bytes: Vec<u8>,
    bit_count: usize,
}

impl TestBitWriter {
    pub(super) fn bit(&mut self, value: bool) {
        if self.bit_count.is_multiple_of(8) {
            self.bytes.push(0);
        }
        if value {
            let bit_index = 7 - self.bit_count % 8;
            *self.bytes.last_mut().unwrap() |= 1 << bit_index;
        }
        self.bit_count += 1;
    }

    pub(super) fn bits(&mut self, value: u64, count: usize) {
        for shift in (0..count).rev() {
            self.bit((value >> shift) & 1 != 0);
        }
    }

    pub(super) fn ue(&mut self, value: u32) {
        let code_num = u64::from(value) + 1;
        let bit_count = (u64::BITS - code_num.leading_zeros()) as usize;
        for _ in 1..bit_count {
            self.bit(false);
        }
        self.bits(code_num, bit_count);
    }

    pub(super) fn finish(mut self) -> Vec<u8> {
        self.bit(true);
        self.bytes
    }
}

/// An 8-bit SPS prefix through `bit_depth_chroma_minus8` with the Main profile.
pub(super) fn synthetic_sps_prefix(
    width: u32,
    height: u32,
    chroma_format_idc: u32,
    separate_colour_plane: bool,
    crop: Option<(u32, u32, u32, u32)>,
) -> Vec<u8> {
    synthetic_sps_with_format(1, width, height, chroma_format_idc, separate_colour_plane, crop, (0, 0))
}

/// An SPS prefix through `bit_depth_chroma_minus8` for `profile_idc` with its
/// matching compatibility flag and the given `bit_depth_*_minus8` values.
pub(super) fn synthetic_sps_with_format(
    profile_idc: u8,
    width: u32,
    height: u32,
    chroma_format_idc: u32,
    separate_colour_plane: bool,
    crop: Option<(u32, u32, u32, u32)>,
    bit_depth_minus8: (u32, u32),
) -> Vec<u8> {
    let mut bits = TestBitWriter::default();
    bits.bits(0, 4); // sps_video_parameter_set_id
    bits.bits(0, 3); // sps_max_sub_layers_minus1
    bits.bit(true); // sps_temporal_id_nesting_flag
    bits.bits(u64::from(profile_idc), 8); // Main tier, profile_idc
    bits.bits(1 << (31 - profile_idc), 32); // matching compatibility flag
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
    bits.ue(bit_depth_minus8.0);
    bits.ue(bit_depth_minus8.1);

    let mut nal = vec![NAL_TYPE_SPS << 1, 1];
    nal.extend_from_slice(&encode_test_ebsp(&bits.finish()));
    nal
}

pub(super) fn synthetic_sps_with_sub_layers(
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
    bits.ue(0); // bit_depth_luma_minus8
    bits.ue(0); // bit_depth_chroma_minus8
    let mut nal = vec![NAL_TYPE_SPS << 1, 1];
    nal.extend_from_slice(&encode_test_ebsp(&bits.finish()));
    nal
}

pub(super) fn encode_test_ebsp(rbsp: &[u8]) -> Vec<u8> {
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

pub(super) fn nal(nal_type: u8, body: &[u8]) -> Vec<u8> {
    let mut nal = vec![nal_type << 1, 1];
    nal.extend_from_slice(body);
    nal
}

pub(super) fn ap(nals: &[Vec<u8>]) -> Vec<u8> {
    let mut payload = vec![NAL_TYPE_AP << 1, 1];
    for nal in nals {
        payload.extend_from_slice(&(nal.len() as u16).to_be_bytes());
        payload.extend_from_slice(nal);
    }
    payload
}

pub(super) fn fu(nal_type: u8, start: bool, end: bool, fragment: &[u8]) -> Vec<u8> {
    let mut payload = vec![NAL_TYPE_FU << 1, 1];
    payload.push((u8::from(start) << 7) | (u8::from(end) << 6) | nal_type);
    payload.extend_from_slice(fragment);
    payload
}

pub(super) fn packet<'a>(
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

pub(super) fn push(
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

pub(super) fn synchronize(assembler: &mut HevcAccessUnitAssembler, sequence_number: u16) {
    let boundary = nal(39, &[0xaa]);
    assert!(
        push(assembler, sequence_number, 1, true, &boundary).is_empty(),
        "the startup access unit must be discarded"
    );
}

pub(super) fn prime_parameter_sets(
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

pub(super) fn access_units(events: Vec<HevcDepacketizerEvent>) -> Vec<HevcAccessUnit> {
    events
        .into_iter()
        .filter_map(|event| match event {
            HevcDepacketizerEvent::AccessUnit(access_unit) => Some(access_unit),
            _ => None,
        })
        .collect()
}

pub(super) fn has_discontinuity(events: &[HevcDepacketizerEvent], expected: HevcDiscontinuity) -> bool {
    events.iter().any(
        |event| matches!(event, HevcDepacketizerEvent::Discontinuity(actual) if *actual == expected),
    )
}

pub(super) fn length_prefixed(nals: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for nal in nals {
        bytes.extend_from_slice(&(nal.len() as u32).to_be_bytes());
        bytes.extend_from_slice(nal);
    }
    bytes
}
