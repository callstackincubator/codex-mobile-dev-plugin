use crate::media::hevc::{GeneralProfile, HevcParameterSets};

pub struct Configuration {
    pub revision: u64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub description: Vec<u8>,
}

/// The RFC 6381 `hvc1` codec string (ISO/IEC 14496-15 Annex E).
fn codec_string(profile: &GeneralProfile) -> String {
    let space = ["", "A", "B", "C"][usize::from(profile.profile_space & 3)];
    let compatibility = profile.compatibility_flags.reverse_bits();
    let tier = if profile.high_tier { "H" } else { "L" };
    let mut constraints = profile.constraint_flags.as_slice();
    while let [rest @ .., 0] = constraints { constraints = rest; }
    let constraint_string = constraints.iter().map(|byte| format!(".{byte:X}")).collect::<String>();
    format!("hvc1.{space}{}.{compatibility:X}.{tier}{}{constraint_string}", profile.profile_idc, profile.level_idc)
}

/// The general profile, tier and level bytes in `profile_tier_level` order.
fn profile_tier_level_bytes(profile: &GeneralProfile) -> [u8; 12] {
    let mut bytes = [0; 12];
    bytes[0] = (profile.profile_space << 6) | (u8::from(profile.high_tier) << 5) | (profile.profile_idc & 31);
    bytes[1..5].copy_from_slice(&profile.compatibility_flags.to_be_bytes());
    bytes[5..11].copy_from_slice(&profile.constraint_flags);
    bytes[11] = profile.level_idc;
    bytes
}

/// Builds the decoder configuration: the codec string and the
/// HEVCDecoderConfigurationRecord (`hvcC`) with one VPS, SPS and PPS array.
pub fn configuration(parameters: HevcParameterSets) -> Result<Configuration, String> {
    let sps = parameters.sps;
    let codec = codec_string(&sps.profile);
    let mut description = vec![1];
    description.extend_from_slice(&profile_tier_level_bytes(&sps.profile));
    description.extend_from_slice(&[0xf0, 0, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f, 3]);
    for (nal_type, bytes) in [(32, parameters.video_parameter_set), (33, parameters.sequence_parameter_set), (34, parameters.picture_parameter_set)] {
        let length = u16::try_from(bytes.len()).map_err(|_| "HEVC parameter set exceeds the supported size.")?;
        description.push(0x80 | nal_type);
        description.extend_from_slice(&1u16.to_be_bytes());
        description.extend_from_slice(&length.to_be_bytes());
        description.extend_from_slice(&bytes);
    }
    Ok(Configuration { revision: parameters.revision, width: sps.pixel_width, height: sps.pixel_height, codec, description })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::hevc::SpsInfo;

    const VPS: [u8; 3] = [0x40, 1, 0x10];
    const PPS: [u8; 3] = [0x44, 1, 0x30];
    // The synthetic 64x64 8-bit 4:2:0 SPS from the HEVC tests.
    const SPS_64_X_64: [u8; 39] = [
        0x42, 0x01, 0x01, 0x04, 0x08, 0x00, 0x00, 0x03, 0x00, 0x9f, 0xa8, 0x00, 0x00, 0x03, 0x00,
        0x00, 0xff, 0xa0, 0x20, 0x81, 0x05, 0x96, 0xea, 0x49, 0x32, 0xbc, 0x05, 0xa0, 0x20, 0x00,
        0x00, 0x03, 0x00, 0x20, 0x00, 0x00, 0x03, 0x00, 0x21,
    ];
    // The general fields of that SPS: RExt profile 4 at level 255.
    const PROFILE_64_X_64: GeneralProfile = GeneralProfile {
        profile_space: 0, high_tier: false, profile_idc: 4, compatibility_flags: 0x0800_0000,
        constraint_flags: [0x9f, 0xa8, 0, 0, 0, 0], level_idc: 255,
    };

    fn parameters(sps: SpsInfo, sequence_parameter_set: &[u8]) -> HevcParameterSets {
        HevcParameterSets {
            revision: 1, sps, video_parameter_set: VPS.to_vec(),
            sequence_parameter_set: sequence_parameter_set.to_vec(), picture_parameter_set: PPS.to_vec(),
        }
    }

    #[test]
    fn keeps_the_codec_string_and_record_of_8_bit_4_2_0_streams() {
        let sps = SpsInfo { profile: PROFILE_64_X_64, chroma_format_idc: 1, bit_depth_luma: 8, bit_depth_chroma: 8, pixel_width: 64, pixel_height: 64 };
        let configuration = configuration(parameters(sps, &SPS_64_X_64)).unwrap();
        assert_eq!(configuration.codec, "hvc1.4.10.L255.9F.A8");
        // Produced by the implementation that read profile bytes at fixed offsets.
        let mut expected = vec![
            0x01, 0x04, 0x08, 0x00, 0x00, 0x00, 0x9f, 0xa8, 0x00, 0x00, 0x00, 0x00, 0xff, 0xf0, 0x00, 0xfc,
            0xfd, 0xf8, 0xf8, 0x00, 0x00, 0x0f, 0x03, 0xa0, 0x00, 0x01, 0x00, 0x03, 0x40, 0x01, 0x10, 0xa1,
            0x00, 0x01, 0x00, 0x27,
        ];
        expected.extend_from_slice(&SPS_64_X_64);
        expected.extend_from_slice(&[0xa2, 0x00, 0x01, 0x00, 0x03, 0x44, 0x01, 0x30]);
        assert_eq!(configuration.description, expected);
        assert_eq!((configuration.width, configuration.height, configuration.revision), (64, 64, 1));
    }

    #[test]
    fn formats_profile_space_tier_and_trims_trailing_constraint_bytes() {
        let profile = GeneralProfile {
            profile_space: 1, high_tier: true, profile_idc: 1, compatibility_flags: 0x6000_0000,
            constraint_flags: [0xb0, 0, 0x10, 0, 0, 0], level_idc: 153,
        };
        assert_eq!(codec_string(&profile), "hvc1.A1.6.H153.B0.0.10");
        assert_eq!(profile_tier_level_bytes(&profile), [0x61, 0x60, 0, 0, 0, 0xb0, 0, 0x10, 0, 0, 0, 153]);
    }

    #[test]
    fn rejects_parameter_sets_that_do_not_fit_the_record() {
        let sps = SpsInfo { profile: PROFILE_64_X_64, chroma_format_idc: 1, bit_depth_luma: 8, bit_depth_chroma: 8, pixel_width: 64, pixel_height: 64 };
        let oversized = vec![0x42; usize::from(u16::MAX) + 1];
        assert!(configuration(parameters(sps, &oversized)).is_err());
    }
}
