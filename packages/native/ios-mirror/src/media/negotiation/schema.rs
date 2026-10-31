// Jackson Coxson
//
// Strict decoding of the `VCMediaNegotiationBlobV2` stream groups that an
// uncompressed device answer carries. Field numbers are in
// `media_negotiation.proto` (reverse-engineered from AVConference).
//
//     1 generalInfo        message, framing checked only
//     2 bandwidthSettings  message of uint32 fields
//     3 codecFeatures      message of uint32 fields
//     7 streamGroups       repeated StreamGroup
//
// Only the fields used to select the HEVC sender are kept. Every other field
// of a decoded message is still checked, so a truncated message or a uint32
// field whose value does not fit is rejected instead of being truncated.

use crate::media::protobuf::{Decoder, Field, Malformed, check_framing, uint32};

pub(super) const STREAM_GROUP_SCREEN: u32 = 3;

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct StreamGroup {
    pub stream_group: u32,
    pub payloads: Vec<StreamGroupPayload>,
    pub streams: Vec<StreamGroupStream>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct StreamGroupPayload {
    pub rtp_payload: Option<u32>,
    pub cipher_suite: u32,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct StreamGroupStream {
    pub rtp_ssrc: Option<u32>,
}

/// Decodes the stream groups of an uncompressed negotiation blob.
pub(super) fn decode_stream_groups(blob: &[u8]) -> Result<Vec<StreamGroup>, Malformed> {
    let mut groups = Vec::new();
    for field in Decoder::new(blob) {
        match field? {
            (1, Field::Len(general_info)) => check_framing(general_info)?,
            (2 | 3, Field::Len(settings)) => check_uint32_message(settings)?,
            (7, Field::Len(group)) => groups.push(decode_stream_group(group)?),
            _ => {}
        }
    }
    Ok(groups)
}

/// Yields the varint fields of a message whose scalars are all `uint32`.
/// Length-delimited fields are framing-checked and skipped.
fn uint32_fields(message: &[u8]) -> impl Iterator<Item = Result<(u32, u32), Malformed>> + '_ {
    Decoder::new(message).filter_map(|field| match field {
        Ok((number, Field::Varint(value))) => Some(uint32(value).map(|value| (number, value))),
        Ok((_, Field::Len(_))) => None,
        Err(error) => Some(Err(error)),
    })
}

fn check_uint32_message(message: &[u8]) -> Result<(), Malformed> {
    uint32_fields(message).try_for_each(|field| field.map(|_| ()))
}

fn decode_stream_group(message: &[u8]) -> Result<StreamGroup, Malformed> {
    let mut group = StreamGroup::default();
    for field in Decoder::new(message) {
        match field? {
            (number, Field::Varint(value)) => {
                let value = uint32(value)?;
                if number == 1 {
                    group.stream_group = value;
                }
            }
            (2, Field::Len(payload)) => group.payloads.push(decode_payload(payload)?),
            (3, Field::Len(stream)) => group.streams.push(decode_stream(stream)?),
            (4, Field::Len(settings)) => check_stream_settings(settings)?,
            (_, Field::Len(_)) => {}
        }
    }
    Ok(group)
}

fn decode_payload(message: &[u8]) -> Result<StreamGroupPayload, Malformed> {
    let mut payload = StreamGroupPayload::default();
    for field in uint32_fields(message) {
        match field? {
            (2, value) => payload.rtp_payload = Some(value),
            (8, value) => payload.cipher_suite = value,
            _ => {}
        }
    }
    Ok(payload)
}

fn decode_stream(message: &[u8]) -> Result<StreamGroupStream, Malformed> {
    let mut stream = StreamGroupStream::default();
    for field in uint32_fields(message) {
        if let (4, value) = field? {
            stream.rtp_ssrc = Some(value);
        }
    }
    Ok(stream)
}

/// `SettingsU1`: uint32 scalars and repeated uint32 `EncodeDecodeFeatures`
/// messages in field 2.
fn check_stream_settings(message: &[u8]) -> Result<(), Malformed> {
    for field in Decoder::new(message) {
        match field? {
            (_, Field::Varint(value)) => {
                uint32(value)?;
            }
            (2, Field::Len(features)) => check_uint32_message(features)?,
            (_, Field::Len(_)) => {}
        }
    }
    Ok(())
}
