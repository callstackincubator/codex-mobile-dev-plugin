// Jackson Coxson
//
// Selects the HEVC sender identity (RTP payload type and SSRC) from the
// device's `negotiatorAnswer`.
//
// The answer is a binary plist whose media blob comes in one of two formats:
//
// - legacy: zlib( protobuf ) whose top-level field 5 entries are video groups
//   (1 = sender SSRC, 3 = codec descriptors with 1 = payload type,
//   4 = codec type, 8 = cipher suite), the shape of our own screen offer;
// - uncompressed `VCMediaNegotiationBlobV2`, whose screen stream groups list
//   payloads and streams separately (see `schema.rs`).
//
// Both formats are reduced to the same list of HEVC candidates, and one
// precedence ladder (`select_stream`) picks the stream or reports why none
// qualifies.

use std::io::Read;

use flate2::read::ZlibDecoder;
use thiserror::Error;

use super::schema::{STREAM_GROUP_SCREEN, decode_stream_groups};
use super::{KEY_MEDIA_BLOB, MAX_NEGOTIATOR_MEDIA_BLOB_SIZE};
use crate::media::protobuf::{Decoder, Field, Malformed};

const LEGACY_VIDEO_GROUP: u32 = 5;
const LEGACY_CODEC_HEVC: u64 = 14;

/// HEVC RTP identity declared by the device's screen-answer blob.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenVideoStream {
    pub payload_type: u8,
    pub ssrc: u32,
}

/// Closed structural failures while selecting the HEVC sender identity from a
/// CoreDevice screen-negotiation answer.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ScreenVideoAnswerError {
    #[error("the negotiation answer envelope is invalid")]
    InvalidEnvelope,
    #[error("the negotiation answer has no media blob")]
    MediaBlobMissing,
    #[error("the negotiation answer media blob is invalid")]
    MediaBlobInvalid,
    #[error("the negotiation answer media blob exceeds the supported limit")]
    MediaBlobTooLarge,
    #[error("the negotiation answer has no video stream group")]
    VideoGroupMissing,
    #[error("the video stream group has no HEVC payload")]
    HevcPayloadMissing,
    #[error("the HEVC descriptor has no payload type")]
    PayloadTypeMissing,
    #[error("the HEVC descriptor has an invalid payload type")]
    PayloadTypeInvalid,
    #[error("the HEVC descriptor requires encrypted media")]
    PayloadEncrypted,
    #[error("the HEVC stream has no sender SSRC")]
    SsrcMissing,
    #[error("the HEVC stream declares a zero sender SSRC")]
    SsrcZero,
    #[error("the HEVC stream declares an invalid sender SSRC")]
    SsrcInvalid,
    #[error("the negotiation answer declares multiple HEVC sender identities")]
    AmbiguousStream,
}

impl From<Malformed> for ScreenVideoAnswerError {
    fn from(_: Malformed) -> Self {
        Self::MediaBlobInvalid
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PayloadType {
    Valid(u8),
    Missing,
    Invalid,
    Encrypted,
}

impl PayloadType {
    fn new(raw: Option<u64>, cipher_suite: u64) -> Self {
        if cipher_suite != 0 {
            return Self::Encrypted;
        }
        match raw.map(u8::try_from) {
            None => Self::Missing,
            Some(Ok(value)) if (1..=127).contains(&value) => Self::Valid(value),
            Some(_) => Self::Invalid,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ssrc {
    Valid(u32),
    Missing,
    Zero,
    Invalid,
}

impl Ssrc {
    fn new(raw: Option<u64>) -> Self {
        match raw.map(u32::try_from) {
            None => Self::Missing,
            Some(Ok(0)) => Self::Zero,
            Some(Ok(value)) => Self::Valid(value),
            Some(Err(_)) => Self::Invalid,
        }
    }
}

/// One HEVC payload descriptor of a video group, paired with one sender SSRC
/// declared by the same group.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HevcCandidate {
    payload_type: PayloadType,
    ssrc: Ssrc,
}

/// What an answer offered: whether it had any video group, and every HEVC
/// candidate of those groups.
#[derive(Debug, Default)]
struct AnswerStreams {
    video_group: bool,
    candidates: Vec<HevcCandidate>,
}

/// Parses the authenticated sender identity from a device negotiation answer.
pub fn parse_screen_video_answer(
    answer: &[u8],
) -> Result<ScreenVideoStream, ScreenVideoAnswerError> {
    let value: plist::Value =
        plist::from_bytes(answer).map_err(|_| ScreenVideoAnswerError::InvalidEnvelope)?;
    let blob = value
        .as_dictionary()
        .and_then(|dictionary| dictionary.get(KEY_MEDIA_BLOB))
        .and_then(plist::Value::as_data)
        .ok_or(ScreenVideoAnswerError::MediaBlobMissing)?;
    let streams = match inflate(blob) {
        Some(raw) => {
            if raw.len() as u64 > MAX_NEGOTIATOR_MEDIA_BLOB_SIZE {
                return Err(ScreenVideoAnswerError::MediaBlobTooLarge);
            }
            legacy_streams(&raw)?
        }
        None => {
            if blob.len() as u64 > MAX_NEGOTIATOR_MEDIA_BLOB_SIZE {
                return Err(ScreenVideoAnswerError::MediaBlobTooLarge);
            }
            uncompressed_streams(blob)?
        }
    };
    select_stream(&streams)
}

/// Inflates a legacy blob, reading at most one byte past the size limit.
/// Returns `None` when the blob is not zlib data.
fn inflate(blob: &[u8]) -> Option<Vec<u8>> {
    let mut raw = Vec::new();
    ZlibDecoder::new(blob)
        .take(MAX_NEGOTIATOR_MEDIA_BLOB_SIZE + 1)
        .read_to_end(&mut raw)
        .ok()?;
    Some(raw)
}

fn legacy_streams(raw: &[u8]) -> Result<AnswerStreams, Malformed> {
    let mut streams = AnswerStreams::default();
    for field in Decoder::new(raw) {
        let (LEGACY_VIDEO_GROUP, Field::Len(group)) = field? else {
            continue;
        };
        streams.video_group = true;
        let mut raw_ssrc = None;
        let mut payload_types = Vec::new();
        for field in Decoder::new(group) {
            match field? {
                (1, Field::Varint(value)) => raw_ssrc = Some(value),
                (3, Field::Len(codec)) => {
                    let mut payload_type = None;
                    let mut codec_type = None;
                    let mut cipher_suite = 0;
                    for field in Decoder::new(codec) {
                        match field? {
                            (1, Field::Varint(value)) => payload_type = Some(value),
                            (4, Field::Varint(value)) => codec_type = Some(value),
                            (8, Field::Varint(value)) => cipher_suite = value,
                            _ => {}
                        }
                    }
                    if codec_type == Some(LEGACY_CODEC_HEVC) {
                        payload_types.push(PayloadType::new(payload_type, cipher_suite));
                    }
                }
                _ => {}
            }
        }
        let ssrc = Ssrc::new(raw_ssrc);
        streams.candidates.extend(payload_types.into_iter().map(|payload_type| HevcCandidate { payload_type, ssrc }));
    }
    Ok(streams)
}

/// Every payload of a screen stream group is a candidate; the V2 schema does
/// not mark HEVC payloads by codec type.
fn uncompressed_streams(raw: &[u8]) -> Result<AnswerStreams, Malformed> {
    let mut streams = AnswerStreams::default();
    for group in decode_stream_groups(raw)? {
        if group.stream_group != STREAM_GROUP_SCREEN {
            continue;
        }
        streams.video_group = true;
        let ssrcs: Vec<Ssrc> = if group.streams.is_empty() {
            vec![Ssrc::Missing]
        } else {
            group.streams.iter().map(|stream| Ssrc::new(stream.rtp_ssrc.map(u64::from))).collect()
        };
        for payload in &group.payloads {
            let payload_type = PayloadType::new(payload.rtp_payload.map(u64::from), u64::from(payload.cipher_suite));
            streams.candidates.extend(ssrcs.iter().map(|&ssrc| HevcCandidate { payload_type, ssrc }));
        }
    }
    Ok(streams)
}

/// Picks the single decodable HEVC sender, or the first failure in this order:
///
/// 1. more than one distinct (payload type, SSRC) pair: `AmbiguousStream`;
/// 2. no video group: `VideoGroupMissing`;
/// 3. no HEVC payload in any video group: `HevcPayloadMissing`;
/// 4. any encrypted HEVC payload: `PayloadEncrypted`;
/// 5. no payload with a usable type: `PayloadTypeInvalid` if any type was out
///    of range, otherwise `PayloadTypeMissing`;
/// 6. for payloads with a usable type: `SsrcZero`, then `SsrcInvalid`, then
///    `SsrcMissing`.
///
/// Earlier releases ranked uncompressed-format failures separately. Compared
/// with that ladder: a payload without a type is `PayloadTypeMissing` (was
/// `PayloadTypeInvalid`), a stream without an SSRC is `SsrcMissing` (was
/// `SsrcZero`), and an out-of-range payload type only wins when no payload has
/// a usable type (an answer that also had a usable type with a zero or missing
/// SSRC used to report `PayloadTypeInvalid`). The legacy format's results are
/// unchanged.
fn select_stream(streams: &AnswerStreams) -> Result<ScreenVideoStream, ScreenVideoAnswerError> {
    let candidates = &streams.candidates;
    let mut selected: Vec<ScreenVideoStream> = Vec::new();
    for candidate in candidates {
        if let (PayloadType::Valid(payload_type), Ssrc::Valid(ssrc)) = (candidate.payload_type, candidate.ssrc) {
            let stream = ScreenVideoStream { payload_type, ssrc };
            if !selected.contains(&stream) {
                selected.push(stream);
            }
        }
    }
    match selected.as_slice() {
        [stream] => return Ok(*stream),
        [_, _, ..] => return Err(ScreenVideoAnswerError::AmbiguousStream),
        [] => {}
    }
    if !streams.video_group {
        return Err(ScreenVideoAnswerError::VideoGroupMissing);
    }
    if candidates.is_empty() {
        return Err(ScreenVideoAnswerError::HevcPayloadMissing);
    }
    let has_payload_type = |expected: PayloadType| candidates.iter().any(|candidate| candidate.payload_type == expected);
    if has_payload_type(PayloadType::Encrypted) {
        return Err(ScreenVideoAnswerError::PayloadEncrypted);
    }
    let usable: Vec<Ssrc> = candidates.iter()
        .filter(|candidate| matches!(candidate.payload_type, PayloadType::Valid(_)))
        .map(|candidate| candidate.ssrc)
        .collect();
    if usable.is_empty() {
        return Err(if has_payload_type(PayloadType::Invalid) {
            ScreenVideoAnswerError::PayloadTypeInvalid
        } else {
            ScreenVideoAnswerError::PayloadTypeMissing
        });
    }
    if usable.contains(&Ssrc::Zero) {
        return Err(ScreenVideoAnswerError::SsrcZero);
    }
    if usable.contains(&Ssrc::Invalid) {
        return Err(ScreenVideoAnswerError::SsrcInvalid);
    }
    Err(ScreenVideoAnswerError::SsrcMissing)
}
