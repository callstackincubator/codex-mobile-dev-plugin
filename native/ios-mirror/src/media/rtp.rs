// Jackson Coxson
//
// RTP parsing for the CoreDevice display stream.
//
// The device sends a plaintext RTP stream (no SRTP, the negotiated
// SRTPCipherSuite is 0) to the receiver address/port we hand it in the
// `startvideooutput` request. Video is HEVC, dynamic payload type 100.
//
// This module only parses the RTP framing; HEVC access-unit reassembly and
// decoding build on top of `RtpPacket`.

/// A parsed RTP packet (RFC 3550), borrowing its payload from the input buffer.
#[derive(Debug, Clone)]
pub struct RtpPacket<'a> {
    pub version: u8,
    pub padding: bool,
    pub extension: bool,
    pub marker: bool,
    pub payload_type: u8,
    pub sequence_number: u16,
    pub timestamp: u32,
    pub ssrc: u32,
    pub csrc: Vec<u32>,
    /// Profile-specific extension header (id, data) if `extension` is set.
    pub ext_profile: u16,
    pub ext_data: &'a [u8],
    /// The media payload (after CSRC list, extension, and minus any padding).
    pub payload: &'a [u8],
}

/// Structural RTP framing failure. Variants never contain packet bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RtpParseError {
    HeaderTruncated,
    UnsupportedVersion,
    CsrcTruncated,
    ExtensionHeaderTruncated,
    ExtensionDataTruncated,
    InvalidPadding,
}

impl<'a> RtpPacket<'a> {
    /// Parse an RTP packet from a UDP datagram. Returns `None` if malformed.
    pub fn parse(buf: &'a [u8]) -> Option<Self> {
        Self::parse_checked(buf).ok()
    }

    /// Parse an RTP packet and retain the framing reason when it is malformed.
    pub fn parse_checked(buf: &'a [u8]) -> Result<Self, RtpParseError> {
        if buf.len() < 12 {
            return Err(RtpParseError::HeaderTruncated);
        }
        let b0 = buf[0];
        let version = b0 >> 6;
        if version != 2 {
            return Err(RtpParseError::UnsupportedVersion);
        }
        let padding = b0 & 0x20 != 0;
        let extension = b0 & 0x10 != 0;
        let csrc_count = (b0 & 0x0f) as usize;

        let b1 = buf[1];
        let marker = b1 & 0x80 != 0;
        let payload_type = b1 & 0x7f;

        let sequence_number = u16::from_be_bytes([buf[2], buf[3]]);
        let timestamp = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]);
        let ssrc = u32::from_be_bytes([buf[8], buf[9], buf[10], buf[11]]);

        let mut off = 12;
        let csrc_end = off + csrc_count * 4;
        let csrc_bytes = buf.get(off..csrc_end).ok_or(RtpParseError::CsrcTruncated)?;
        let mut csrc = Vec::with_capacity(csrc_count);
        for w in csrc_bytes.chunks_exact(4) {
            csrc.push(u32::from_be_bytes([w[0], w[1], w[2], w[3]]));
        }
        off = csrc_end;

        let mut ext_profile = 0u16;
        let mut ext_data: &[u8] = &[];
        if extension {
            let hdr = buf
                .get(off..off + 4)
                .ok_or(RtpParseError::ExtensionHeaderTruncated)?;
            ext_profile = u16::from_be_bytes([hdr[0], hdr[1]]);
            let ext_words = u16::from_be_bytes([hdr[2], hdr[3]]) as usize;
            off += 4;
            let ext_len = ext_words * 4;
            ext_data = buf
                .get(off..off + ext_len)
                .ok_or(RtpParseError::ExtensionDataTruncated)?;
            off += ext_len;
        }

        let mut end = buf.len();
        if padding {
            // Last byte is the padding length (including itself).
            let pad = *buf.last().ok_or(RtpParseError::HeaderTruncated)? as usize;
            if pad == 0 || pad > end.saturating_sub(off) {
                return Err(RtpParseError::InvalidPadding);
            }
            end -= pad;
        }
        let payload = buf.get(off..end).ok_or(RtpParseError::InvalidPadding)?;

        Ok(RtpPacket {
            version,
            padding,
            extension,
            marker,
            payload_type,
            sequence_number,
            timestamp,
            ssrc,
            csrc,
            ext_profile,
            ext_data,
            payload,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_rtp() {
        // V=2, PT=100, marker set, seq=1, ts=2, ssrc=3, payload "hi"
        let mut pkt = vec![0x80, 0x80 | 100, 0x00, 0x01, 0, 0, 0, 2, 0, 0, 0, 3];
        pkt.extend_from_slice(b"hi");
        let p = RtpPacket::parse(&pkt).unwrap();
        assert_eq!(p.payload_type, 100);
        assert!(p.marker);
        assert_eq!(p.sequence_number, 1);
        assert_eq!(p.timestamp, 2);
        assert_eq!(p.ssrc, 3);
        assert_eq!(p.payload, b"hi");
    }

    #[test]
    fn parses_extension_header() {
        // extension bit set, 1 ext word
        let pkt = vec![
            0x90, 100, 0, 1, 0, 0, 0, 0, 0, 0, 0, 5, // header
            0xBE, 0xDE, 0, 1, // ext profile 0xBEDE, 1 word
            0xAA, 0xBB, 0xCC, 0xDD, // ext data
            0x01, 0x02, // payload
        ];
        let p = RtpPacket::parse(&pkt).unwrap();
        assert_eq!(p.ext_profile, 0xBEDE);
        assert_eq!(p.ext_data, &[0xAA, 0xBB, 0xCC, 0xDD]);
        assert_eq!(p.payload, &[0x01, 0x02]);
    }

    #[test]
    fn checked_parser_reports_each_framing_failure_without_panicking() {
        let cases = [
            (&[][..], RtpParseError::HeaderTruncated),
            (&[0; 12][..], RtpParseError::UnsupportedVersion),
            (
                &[0x81, 100, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1][..],
                RtpParseError::CsrcTruncated,
            ),
            (
                &[0x90, 100, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1][..],
                RtpParseError::ExtensionHeaderTruncated,
            ),
            (
                &[
                    0x90, 100, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0xbe, 0xde, 0, 2, 1, 2, 3, 4,
                ][..],
                RtpParseError::ExtensionDataTruncated,
            ),
            (
                &[0xa0, 100, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0][..],
                RtpParseError::InvalidPadding,
            ),
            (
                &[0xa0, 100, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2][..],
                RtpParseError::InvalidPadding,
            ),
        ];

        for (packet, expected) in cases {
            assert_eq!(RtpPacket::parse_checked(packet).unwrap_err(), expected);
            assert!(RtpPacket::parse(packet).is_none());
        }
    }

    #[test]
    fn checked_parser_handles_csrc_extension_and_padding_together() {
        let packet = [
            0xb1,
            0x80 | 100,
            0x12,
            0x34,
            0,
            0,
            0,
            2,
            0,
            0,
            0,
            3, // base
            0xaa,
            0xbb,
            0xcc,
            0xdd, // one CSRC
            0xbe,
            0xde,
            0,
            1, // extension header
            1,
            2,
            3,
            4, // extension body
            5,
            6, // payload
            0,
            2, // padding
        ];
        let parsed = RtpPacket::parse_checked(&packet).expect("valid RTP");
        assert_eq!(parsed.csrc, vec![0xaabb_ccdd]);
        assert_eq!(parsed.ext_profile, 0xbede);
        assert_eq!(parsed.ext_data, &[1, 2, 3, 4]);
        assert_eq!(parsed.payload, &[5, 6]);
    }

    #[test]
    fn checked_parser_is_panic_free_for_arbitrary_datagrams() {
        let mut state = 0xa16c_4e29u32;
        for length in 0..=512 {
            let mut datagram = vec![0; length];
            for byte in &mut datagram {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                *byte = state as u8;
            }
            let _ = RtpPacket::parse_checked(&datagram);
        }
    }
}
