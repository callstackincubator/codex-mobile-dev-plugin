use crate::media::hevc::HevcParameterSets;

pub struct Configuration {
    pub revision: u64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub description: Vec<u8>,
}

pub fn configuration(parameters: HevcParameterSets) -> Result<Configuration, String> {
    let mut rbsp = Vec::with_capacity(parameters.sequence_parameter_set.len());
    let mut zeroes = 0;
    for byte in parameters.sequence_parameter_set.iter().skip(2).copied() {
        if zeroes >= 2 && byte == 3 { zeroes = 0; continue; }
        rbsp.push(byte);
        zeroes = if byte == 0 { zeroes + 1 } else { 0 };
    }
    if rbsp.len() < 13 { return Err("Invalid HEVC profile.".into()); }
    let profile = rbsp[1];
    let space = ["", "A", "B", "C"][(profile >> 6) as usize];
    let compatibility = u32::from_be_bytes(rbsp[2..6].try_into().unwrap()).reverse_bits();
    let tier = if profile & 32 == 0 { "L" } else { "H" };
    let mut constraints = rbsp[6..12].to_vec();
    while constraints.last() == Some(&0) { constraints.pop(); }
    let constraint_string = constraints.iter().map(|byte| format!(".{byte:X}")).collect::<String>();
    let codec = format!("hvc1.{space}{}.{compatibility:X}.{tier}{}{constraint_string}", profile & 31, rbsp[12]);
    let mut description = vec![1];
    description.extend_from_slice(&rbsp[1..13]);
    description.extend_from_slice(&[0xf0, 0, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f, 3]);
    for (nal_type, bytes) in [(32, parameters.video_parameter_set), (33, parameters.sequence_parameter_set), (34, parameters.picture_parameter_set)] {
        let length = u16::try_from(bytes.len()).map_err(|_| "HEVC parameter set exceeds the supported size.")?;
        description.push(0x80 | nal_type);
        description.extend_from_slice(&1u16.to_be_bytes());
        description.extend_from_slice(&length.to_be_bytes());
        description.extend_from_slice(&bytes);
    }
    Ok(Configuration { revision: parameters.revision, width: parameters.pixel_width, height: parameters.pixel_height, codec, description })
}
