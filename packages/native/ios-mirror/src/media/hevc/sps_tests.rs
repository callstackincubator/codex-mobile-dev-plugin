use super::*;
use crate::media::hevc::test_support::*;
use crate::media::hevc::{NAL_TYPE_SPS, NAL_TYPE_VPS};

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
