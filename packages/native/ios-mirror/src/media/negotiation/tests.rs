use std::io::Read;

use super::offer::{NEGOTIATOR_MODE_COREDEVICE_AUDIO, NEGOTIATOR_MODE_COREDEVICE_SCREEN, build_screen_media_blob, zlib_compress};
use super::answer::{ScreenVideoAnswerError, ScreenVideoStream};
use super::*;
use crate::media::protobuf::{Decoder, Encoder, Field};

type Answer = Result<ScreenVideoStream, ScreenVideoAnswerError>;
type Group<'a> = &'a dyn Fn(&mut Encoder);

fn answer_with_blob(blob: Vec<u8>) -> Vec<u8> {
    let value = plist::Value::Dictionary(plist::Dictionary::from_iter([(
        KEY_MEDIA_BLOB.to_owned(),
        plist::Value::Data(blob),
    )]));
    let mut answer = Vec::new();
    plist::to_writer_binary(&mut answer, &value).unwrap();
    answer
}

fn legacy_answer(raw: &[u8]) -> Vec<u8> {
    answer_with_blob(zlib_compress(raw).unwrap())
}

fn stream(payload_type: u8, ssrc: u32) -> Answer {
    Ok(ScreenVideoStream { payload_type, ssrc })
}

/// A `VCMediaNegotiationBlobV2` with one stream group per entry, written with
/// the production protobuf encoder.
fn v2_blob(groups: &[Group<'_>]) -> Vec<u8> {
    let mut blob = Encoder::new();
    for group in groups {
        blob.message_field(7, |message| group(message));
    }
    blob.into_bytes()
}

fn screen_group(payloads: &[(Option<u64>, u64)], ssrcs: &[Option<u64>]) -> impl Fn(&mut Encoder) {
    move |group: &mut Encoder| {
        group.uint_field(1, u64::from(schema::STREAM_GROUP_SCREEN));
        for &(payload_type, cipher_suite) in payloads {
            group.message_field(2, |payload| {
                payload.uint_field(1, 14);
                if let Some(payload_type) = payload_type {
                    payload.uint_field(2, payload_type);
                }
                payload.uint_field(8, cipher_suite);
            });
        }
        for &ssrc in ssrcs {
            group.message_field(3, |stream| {
                if let Some(ssrc) = ssrc {
                    stream.uint_field(4, ssrc);
                }
            });
        }
    }
}

fn parse_v2(groups: &[Group<'_>]) -> Answer {
    parse_screen_video_answer(&answer_with_blob(v2_blob(groups)))
}

#[test]
fn video_offer_carries_the_hevc_screen_blob_and_endpoint_info() {
    let call_info = CallInfoBlob { call_id: 0, client_version: 1, device_type: "Mac17,7".into(), framework_version: "2205.3.1".into(), os_version: "25F71".into(), device_name: None, audio_device_uid: None };
    let offer = build_screen_video_offer("CALL", &call_info, 0x1020_3040).unwrap();
    let value: plist::Value = plist::from_bytes(&offer).unwrap();
    let dictionary = value.as_dictionary().unwrap();
    assert_eq!(dictionary.get(KEY_CALL_ID).and_then(plist::Value::as_string), Some("CALL"));
    assert_eq!(dictionary.get(KEY_MODE).and_then(plist::Value::as_signed_integer), Some(NEGOTIATOR_MODE_COREDEVICE_SCREEN));
    assert_eq!(dictionary.get(KEY_REMOTE_ENDPOINT_INFO).and_then(plist::Value::as_data), Some(call_info.encode().as_slice()));

    let compressed = dictionary.get(KEY_MEDIA_BLOB).and_then(plist::Value::as_data).unwrap();
    let mut raw = Vec::new();
    flate2::read::ZlibDecoder::new(compressed).read_to_end(&mut raw).unwrap();
    let fields: Vec<_> = Decoder::new(&raw).collect::<Result<_, _>>().unwrap();
    let screen = fields.iter().find_map(|field| match field { (5, Field::Len(screen)) => Some(*screen), _ => None }).unwrap();
    let screen: Vec<_> = Decoder::new(screen).collect::<Result<_, _>>().unwrap();
    assert_eq!(screen[0], (1, Field::Varint(0x1020_3040)));
    let codecs: Vec<Vec<(u32, Field<'_>)>> = screen.iter()
        .filter_map(|field| match field { (3, Field::Len(codec)) => Some(Decoder::new(codec).collect::<Result<_, _>>().unwrap()), _ => None })
        .collect();
    assert_eq!(codecs.len(), 2);
    assert_eq!(codecs[1].first(), Some(&(1, Field::Varint(100))));
    assert_eq!(codecs[1].last(), Some(&(4, Field::Varint(14))));
}

#[test]
fn audio_offer_uses_the_system_audio_mode() {
    let offer = build_screen_audio_offer("CALL", &CallInfoBlob::default()).unwrap();
    let value: plist::Value = plist::from_bytes(&offer).unwrap();
    let mode = value.as_dictionary().and_then(|dictionary| dictionary.get(KEY_MODE)).and_then(plist::Value::as_signed_integer);
    assert_eq!(mode, Some(NEGOTIATOR_MODE_COREDEVICE_AUDIO));
}

#[test]
fn legacy_screen_answer_parser_returns_the_sender_identity() {
    let raw = [0x2a, 0x08, 0x08, 0x03, 0x1a, 0x04, 0x08, 0x64, 0x20, 0x0e];
    assert_eq!(parse_screen_video_answer(&legacy_answer(&raw)), stream(100, 3));
}

#[test]
fn legacy_answer_in_the_shape_of_our_screen_blob_selects_its_hevc_descriptor() {
    let raw = build_screen_media_blob(0x1020_3040, 0);
    assert_eq!(parse_screen_video_answer(&legacy_answer(&raw)), stream(100, 0x1020_3040));
}

#[test]
fn legacy_screen_answer_parser_reports_the_missing_protocol_boundary() {
    let cases: [(&[u8], ScreenVideoAnswerError); 4] = [
        (&[], ScreenVideoAnswerError::VideoGroupMissing),
        (&[0x2a, 0x02, 0x08, 0x03], ScreenVideoAnswerError::HevcPayloadMissing),
        (&[0x2a, 0x06, 0x08, 0x03, 0x1a, 0x02, 0x20, 0x0e], ScreenVideoAnswerError::PayloadTypeMissing),
        (&[0x2a, 0x08, 0x08, 0x00, 0x1a, 0x04, 0x08, 0x64, 0x20, 0x0e], ScreenVideoAnswerError::SsrcZero),
    ];
    for (raw, expected) in cases {
        assert_eq!(parse_screen_video_answer(&legacy_answer(raw)), Err(expected));
    }
}

#[test]
fn legacy_screen_answer_parser_reports_invalid_identities() {
    let mut invalid_ssrc = Encoder::new();
    invalid_ssrc.message_field(5, |group| {
        group.uint_field(1, 1 << 32);
        group.message_field(3, |codec| { codec.uint_field(1, 100); codec.uint_field(4, 14); });
    });
    let mut invalid_payload_type = Encoder::new();
    invalid_payload_type.message_field(5, |group| {
        group.uint_field(1, 3);
        group.message_field(3, |codec| { codec.uint_field(1, 128); codec.uint_field(4, 14); });
    });
    let mut missing_ssrc = Encoder::new();
    missing_ssrc.message_field(5, |group| {
        group.message_field(3, |codec| { codec.uint_field(1, 100); codec.uint_field(4, 14); });
    });
    let cases = [
        (invalid_ssrc, ScreenVideoAnswerError::SsrcInvalid),
        (invalid_payload_type, ScreenVideoAnswerError::PayloadTypeInvalid),
        (missing_ssrc, ScreenVideoAnswerError::SsrcMissing),
    ];
    for (raw, expected) in cases {
        assert_eq!(parse_screen_video_answer(&legacy_answer(&raw.into_bytes())), Err(expected));
    }
}

#[test]
fn legacy_screen_answer_parser_deduplicates_identical_sender_identity() {
    let group = [0x08, 0x03, 0x1a, 0x04, 0x08, 0x64, 0x20, 0x0e];
    let mut raw = vec![0x2a, group.len() as u8];
    raw.extend_from_slice(&group);
    raw.extend_from_slice(&[0x2a, group.len() as u8]);
    raw.extend_from_slice(&group);
    assert_eq!(parse_screen_video_answer(&legacy_answer(&raw)), stream(100, 3));
}

#[test]
fn legacy_screen_answer_parser_rejects_distinct_sender_identities() {
    let mut raw = Vec::new();
    for ssrc in [3, 4] {
        raw.extend_from_slice(&[0x2a, 0x08, 0x08, ssrc, 0x1a, 0x04, 0x08, 0x64, 0x20, 0x0e]);
    }
    assert_eq!(parse_screen_video_answer(&legacy_answer(&raw)), Err(ScreenVideoAnswerError::AmbiguousStream));
}

#[test]
fn legacy_screen_answer_parser_rejects_malformed_trailing_fields() {
    let valid_group = [0x08, 0x03, 0x1a, 0x04, 0x08, 0x64, 0x20, 0x0e];
    let malformed_tails: [&[u8]; 3] = [&[0x80], &[0x32, 0x02, 0x01], &[0x0b]];
    for malformed_tail in malformed_tails {
        let mut raw = vec![0x2a, valid_group.len() as u8];
        raw.extend_from_slice(&valid_group);
        raw.extend_from_slice(malformed_tail);
        assert_eq!(parse_screen_video_answer(&legacy_answer(&raw)), Err(ScreenVideoAnswerError::MediaBlobInvalid));
    }
}

#[test]
fn legacy_screen_answer_parser_rejects_encrypted_hevc_payloads() {
    let encrypted_codec = [0x08, 0x64, 0x20, 0x0e, 0x40, 0x01];
    let mut group = vec![0x08, 0x03, 0x1a, encrypted_codec.len() as u8];
    group.extend_from_slice(&encrypted_codec);
    let mut raw = vec![0x2a, group.len() as u8];
    raw.extend_from_slice(&group);
    assert_eq!(parse_screen_video_answer(&legacy_answer(&raw)), Err(ScreenVideoAnswerError::PayloadEncrypted));
}

#[test]
fn answer_parser_decodes_the_uncompressed_media_blob() {
    let mut blob = Encoder::new();
    blob.message_field(1, |general| { general.uint_field(1, u64::MAX); general.string_field(2, "host"); });
    blob.message_field(3, |features| { features.uint_field(1, 0); features.bytes_field(2, b"FLS;VRAE:0;SW:1;"); });
    blob.message_field(7, |group| {
        group.uint_field(1, u64::from(schema::STREAM_GROUP_SCREEN));
        group.message_field(2, |payload| { payload.uint_field(1, 1); payload.uint_field(2, 100); payload.uint_field(8, 0); });
        group.message_field(3, |stream| { stream.uint_field(4, 0x1020_3040); stream.uint_field(6, 6_000_000); });
        group.message_field(4, |settings| {
            settings.uint_field(1, 0x1020_3040);
            settings.message_field(2, |features| { features.uint_field(1, 100); features.bytes_field(2, b"FLS;VRAE:0;SW:1;"); });
        });
    });
    assert_eq!(parse_screen_video_answer(&answer_with_blob(blob.into_bytes())), stream(100, 0x1020_3040));
}

#[test]
fn uncompressed_screen_answer_parser_rejects_malformed_messages() {
    let valid_payload = [0x08, 0x0e, 0x10, 0x64];
    let valid_stream = [0x20, 0x03];
    let malformed_tails: [&[u8]; 3] = [&[0x80], &[0x32, 0x02, 0x01], &[0x0b]];
    for malformed_tail in malformed_tails {
        let mut group = vec![0x08, 0x03, 0x12, valid_payload.len() as u8];
        group.extend_from_slice(&valid_payload);
        group.extend_from_slice(&[0x1a, valid_stream.len() as u8]);
        group.extend_from_slice(&valid_stream);
        group.extend_from_slice(malformed_tail);
        let mut raw = vec![0x3a, group.len() as u8];
        raw.extend_from_slice(&group);
        assert_eq!(parse_screen_video_answer(&answer_with_blob(raw)), Err(ScreenVideoAnswerError::MediaBlobInvalid));
    }
}

#[test]
fn uncompressed_screen_answer_parser_rejects_truncated_integers() {
    let cases = [
        (100, 1_u64 << 32, 3),
        ((1_u64 << 32) + 100, 0, 3),
        (100, 0, (1_u64 << 32) + 3),
    ];
    for (payload_type, cipher_suite, ssrc) in cases {
        let payloads = [(Some(payload_type), cipher_suite)];
        let ssrcs = [Some(ssrc)];
        let group = screen_group(&payloads, &ssrcs);
        assert_eq!(parse_v2(&[&group]), Err(ScreenVideoAnswerError::MediaBlobInvalid));
    }
}

#[test]
fn uncompressed_screen_answer_parser_checks_unused_messages_strictly() {
    let mut bandwidth = Encoder::new();
    bandwidth.message_field(2, |settings| settings.uint_field(1, 1 << 32));
    let mut settings = Encoder::new();
    settings.message_field(7, |group| {
        group.uint_field(1, u64::from(schema::STREAM_GROUP_SCREEN));
        group.message_field(4, |settings| settings.message_field(2, |features| features.uint_field(1, 1 << 32)));
    });
    let mut general = Encoder::new();
    general.bytes_field(1, &[0x08]);
    for blob in [bandwidth, settings, general] {
        assert_eq!(parse_screen_video_answer(&answer_with_blob(blob.into_bytes())), Err(ScreenVideoAnswerError::MediaBlobInvalid));
    }
}

#[test]
fn uncompressed_screen_answer_parser_ranks_failures_with_the_shared_ladder() {
    let other_group = |group: &mut Encoder| {
        group.uint_field(1, 1);
        group.message_field(2, |payload| payload.uint_field(2, 100));
        group.message_field(3, |stream| stream.uint_field(4, 3));
    };
    let no_payload = screen_group(&[], &[Some(3)]);
    let encrypted = screen_group(&[(Some(100), 1)], &[Some(3)]);
    let invalid_type = screen_group(&[(Some(0), 0), (Some(128), 0)], &[Some(3)]);
    let missing_type = screen_group(&[(None, 0)], &[Some(3)]);
    let zero_ssrc = screen_group(&[(Some(100), 0)], &[Some(0)]);
    let no_streams = screen_group(&[(Some(100), 0)], &[]);
    let stream_without_ssrc = screen_group(&[(Some(100), 0)], &[None]);
    let invalid_type_beside_zero_ssrc = screen_group(&[(Some(128), 0), (Some(100), 0)], &[Some(0)]);
    let two_streams = screen_group(&[(Some(100), 0)], &[Some(3), Some(4)]);
    let cases: [(&[Group<'_>], Answer); 11] = [
        (&[], Err(ScreenVideoAnswerError::VideoGroupMissing)),
        (&[&other_group], Err(ScreenVideoAnswerError::VideoGroupMissing)),
        (&[&no_payload], Err(ScreenVideoAnswerError::HevcPayloadMissing)),
        (&[&encrypted], Err(ScreenVideoAnswerError::PayloadEncrypted)),
        (&[&invalid_type], Err(ScreenVideoAnswerError::PayloadTypeInvalid)),
        (&[&missing_type], Err(ScreenVideoAnswerError::PayloadTypeMissing)),
        (&[&zero_ssrc], Err(ScreenVideoAnswerError::SsrcZero)),
        (&[&no_streams], Err(ScreenVideoAnswerError::SsrcMissing)),
        (&[&stream_without_ssrc], Err(ScreenVideoAnswerError::SsrcMissing)),
        (&[&invalid_type_beside_zero_ssrc], Err(ScreenVideoAnswerError::SsrcZero)),
        (&[&two_streams], Err(ScreenVideoAnswerError::AmbiguousStream)),
    ];
    for (groups, expected) in cases {
        assert_eq!(parse_v2(groups), expected);
    }
}

#[test]
fn rejects_oversized_media_blobs_in_both_formats() {
    let raw = vec![0; MAX_NEGOTIATOR_MEDIA_BLOB_SIZE as usize + 1];
    assert_eq!(parse_screen_video_answer(&legacy_answer(&raw)), Err(ScreenVideoAnswerError::MediaBlobTooLarge));
    assert_eq!(parse_screen_video_answer(&answer_with_blob(raw)), Err(ScreenVideoAnswerError::MediaBlobTooLarge));
}

#[test]
fn rejects_invalid_envelopes() {
    assert_eq!(parse_screen_video_answer(b"not a plist"), Err(ScreenVideoAnswerError::InvalidEnvelope));
    let empty = plist::Value::Dictionary(plist::Dictionary::new());
    let mut answer = Vec::new();
    plist::to_writer_binary(&mut answer, &empty).unwrap();
    assert_eq!(parse_screen_video_answer(&answer), Err(ScreenVideoAnswerError::MediaBlobMissing));
}
