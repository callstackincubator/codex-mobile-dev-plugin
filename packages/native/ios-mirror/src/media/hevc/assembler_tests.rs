use super::*;
use crate::media::hevc::payload::DISPLAYSERVICE_NAL_TRAILER;
use crate::media::hevc::test_support::*;
use crate::media::hevc::{MAX_REORDER_BUFFER, NAL_TYPE_AP};

#[test]
fn accepts_the_complete_initial_access_unit_from_a_new_stream_epoch() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    let vps = nal(NAL_TYPE_VPS, &[0x10]);
    let sps = SYNTHETIC_64_X_64_SPS.to_vec();
    let pps = nal(NAL_TYPE_PPS, &[0x30]);
    let sync_sample = nal(19, &[0x80]);
    let initial_access_unit = ap(&[vps.clone(), sps.clone(), pps.clone(), sync_sample.clone()]);

    let output = access_units(push(&mut assembler, 1, 1, true, &initial_access_unit));

    assert_eq!(output.len(), 1);
    assert!(output[0].is_sync);
    assert_eq!(
        output[0].bytes,
        length_prefixed(&[vps, sps, pps, sync_sample])
    );
    let configuration = assembler
        .parameter_sets()
        .expect("the initial access unit carries decoder configuration");
    assert_eq!(
        (configuration.pixel_width, configuration.pixel_height),
        (64, 64)
    );
}

#[test]
fn accepts_a_fragmented_decoder_ready_initial_access_unit() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    let vps = nal(NAL_TYPE_VPS, &[0x10]);
    let sps = SYNTHETIC_64_X_64_SPS.to_vec();
    let pps = nal(NAL_TYPE_PPS, &[0x30]);
    let parameters = ap(&[vps.clone(), sps.clone(), pps.clone()]);
    let sync_start = fu(19, true, false, &[0x80, 0x50]);
    let sync_end = fu(19, false, true, &[0x51]);

    assert!(push(&mut assembler, 1, 1, false, &parameters).is_empty());
    assert!(push(&mut assembler, 2, 1, false, &sync_start).is_empty());
    let output = access_units(push(&mut assembler, 3, 1, true, &sync_end));

    assert_eq!(output.len(), 1);
    assert!(output[0].is_sync);
    assert_eq!(
        output[0].bytes,
        length_prefixed(&[vps, sps, pps, nal(19, &[0x80, 0x50, 0x51])])
    );
    let configuration = assembler
        .parameter_sets()
        .expect("the fragmented initial access unit carries decoder configuration");
    assert_eq!(
        (configuration.pixel_width, configuration.pixel_height),
        (64, 64)
    );
}

#[test]
fn discards_a_multi_packet_initial_access_unit_without_decoder_configuration() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    let partial = nal(39, &[0x40]);
    let sync_sample = nal(19, &[0xD0]);

    assert!(push(&mut assembler, 1, 1, false, &partial).is_empty());
    assert!(
        access_units(push(&mut assembler, 2, 1, true, &sync_sample)).is_empty(),
        "an initial access unit without decoder configuration must be discarded"
    );
    assert!(
        assembler.parameter_sets().is_none(),
        "discarded startup bytes must not configure the decoder"
    );

    let complete = ap(&[
        nal(NAL_TYPE_VPS, &[0x10]),
        SYNTHETIC_64_X_64_SPS.to_vec(),
        nal(NAL_TYPE_PPS, &[0x30]),
        sync_sample,
    ]);
    assert_eq!(
        access_units(push(&mut assembler, 3, 2, true, &complete)).len(),
        1,
        "the next complete access unit after the marker boundary should be emitted"
    );
}

#[test]
fn commits_sps_dimensions_atomically_with_parameter_set_revision() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 5);
    let initial = ap(&[
        nal(NAL_TYPE_VPS, &[0x10]),
        SYNTHETIC_64_X_64_SPS.to_vec(),
        nal(NAL_TYPE_PPS, &[0x30]),
    ]);
    assert!(push(&mut assembler, 6, 2, true, &initial).is_empty());
    let first = assembler.parameter_sets().expect("complete configuration");
    assert_eq!((first.pixel_width, first.pixel_height), (64, 64));
    assert_eq!(first.revision, 1);

    let changed = ap(&[
        nal(NAL_TYPE_VPS, &[0x10]),
        SYNTHETIC_96_X_64_SPS.to_vec(),
        nal(NAL_TYPE_PPS, &[0x30]),
    ]);
    assert!(push(&mut assembler, 7, 3, true, &changed).is_empty());
    let second = assembler.parameter_sets().expect("changed configuration");
    assert_eq!((second.pixel_width, second.pixel_height), (96, 64));
    assert_eq!(second.revision, 2);

    let malformed_sps = synthetic_sps_prefix(4, 4, 1, false, Some((2, 1, 0, 0)));
    let rejected = ap(&[
        nal(NAL_TYPE_VPS, &[0x11]),
        malformed_sps,
        nal(NAL_TYPE_PPS, &[0x31]),
    ]);
    let events = push(&mut assembler, 8, 4, true, &rejected);
    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::MalformedPayload
    ));
    assert_eq!(
        assembler.parameter_sets().expect("prior configuration"),
        second
    );
}

#[test]
fn emits_only_complete_marker_closed_length_prefixed_access_units() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 10);
    let parameters = prime_parameter_sets(&mut assembler, 11);

    let prefix = nal(39, &[0x40]);
    let slice = nal(19, &[0xD0, 0x51]);
    assert!(push(&mut assembler, 12, 3, false, &prefix).is_empty());
    let output = access_units(push(&mut assembler, 13, 3, true, &slice));

    assert_eq!(output.len(), 1);
    assert_eq!(output[0].rtp_timestamp, 3);
    assert_eq!(output[0].first_sequence_number, 12);
    assert_eq!(output[0].last_sequence_number, 13);
    assert_eq!(output[0].ssrc, SSRC);
    assert!(output[0].is_sync);
    assert_eq!(output[0].parameter_set_revision, parameters.revision);
    assert_eq!(output[0].bytes, length_prefixed(&[prefix, slice]));
}

#[test]
fn reassembles_fu_and_removes_the_exact_displayservice_slice_trailer() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 20);
    prime_parameter_sets(&mut assembler, 21);

    let first = fu(19, true, false, &[0xaa, 0xbb]);
    let middle = fu(19, false, false, &[0xcc]);
    let mut last_fragment = vec![0xdd];
    last_fragment.extend_from_slice(&DISPLAYSERVICE_NAL_TRAILER);
    let last = fu(19, false, true, &last_fragment);
    assert!(push(&mut assembler, 22, 4, false, &first).is_empty());
    assert!(push(&mut assembler, 23, 4, false, &middle).is_empty());
    let output = access_units(push(&mut assembler, 24, 4, true, &last));

    assert_eq!(output.len(), 1);
    assert_eq!(
        output[0].bytes,
        length_prefixed(&[nal(19, &[0xaa, 0xbb, 0xcc, 0xdd])])
    );
}

#[test]
fn a_slice_containing_only_the_displayservice_trailer_is_malformed() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 25);
    prime_parameter_sets(&mut assembler, 26);

    let mut invalid = vec![1 << 1, 1];
    invalid.extend_from_slice(&DISPLAYSERVICE_NAL_TRAILER);
    let events = push(&mut assembler, 27, 5, true, &invalid);

    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::MalformedPayload
    ));
    assert!(access_units(events).is_empty());
}

#[test]
fn reorders_packets_across_sequence_wrap_without_reordering_nals() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 65_532);
    prime_parameter_sets(&mut assembler, 65_533);

    let first = nal(19, &[0x81]);
    let second = nal(19, &[2]);
    assert!(push(&mut assembler, 65_535, 5, true, &second).is_empty());
    let output = access_units(push(&mut assembler, 65_534, 5, false, &first));
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].bytes, length_prefixed(&[first, second]));

    let wrapped = nal(1, &[3]);
    let output = access_units(push(&mut assembler, 0, 6, true, &wrapped));
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].first_sequence_number, 0);
}

#[test]
fn malformed_ap_is_atomic_and_cannot_poison_parameter_sets() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 30);

    let first = nal(NAL_TYPE_VPS, &[1]);
    let mut malformed = vec![NAL_TYPE_AP << 1, 1];
    malformed.extend_from_slice(&(first.len() as u16).to_be_bytes());
    malformed.extend_from_slice(&first);
    malformed.extend_from_slice(&10u16.to_be_bytes());
    malformed.extend_from_slice(&[NAL_TYPE_SPS << 1, 1]);
    let events = push(&mut assembler, 31, 2, true, &malformed);

    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::MalformedPayload
    ));
    assert!(assembler.parameter_sets().is_none());

    let parameters = prime_parameter_sets(&mut assembler, 32);
    assert_eq!(parameters.revision, 1);
}

#[test]
fn sequence_gap_drops_predicted_frames_until_a_fresh_sync_sample() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 40);
    prime_parameter_sets(&mut assembler, 41);

    let partial = nal(1, &[0xaa]);
    assert!(push(&mut assembler, 42, 10, false, &partial).is_empty());
    let buffered = nal(1, &[0xbb]);
    let mut observed_gap = false;
    for offset in 0..=MAX_REORDER_BUFFER {
        let marker = offset == MAX_REORDER_BUFFER;
        let events = push(
            &mut assembler,
            44u16.wrapping_add(offset as u16),
            11,
            marker,
            &buffered,
        );
        observed_gap |= has_discontinuity(&events, HevcDiscontinuity::SequenceGap);
        assert!(access_units(events).is_empty());
    }
    assert!(observed_gap);

    let first_sequence_after_gap = 44u16.wrapping_add(MAX_REORDER_BUFFER as u16 + 1);
    let predicted = nal(1, &[0xcc]);
    assert!(
        access_units(push(
            &mut assembler,
            first_sequence_after_gap,
            12,
            true,
            &predicted,
        ))
        .is_empty(),
        "a predicted frame with invalid references must not reach the decoder"
    );

    let recovered = nal(19, &[0xdd]);
    let output = access_units(push(
        &mut assembler,
        first_sequence_after_gap.wrapping_add(1),
        13,
        true,
        &recovered,
    ));
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].bytes, length_prefixed(&[recovered]));
}

#[test]
fn reorder_byte_limit_recovers_without_emitting_buffered_partial_data() {
    let limits = DepacketizerLimits {
        max_reorder_bytes: 8,
        ..DepacketizerLimits::default()
    };
    let mut assembler = HevcAccessUnitAssembler::with_limits(PAYLOAD_TYPE, SSRC, limits);
    synchronize(&mut assembler, 50);
    prime_parameter_sets(&mut assembler, 51);

    let buffered = nal(1, &[1, 2, 3, 4]);
    assert!(push(&mut assembler, 53, 10, false, &buffered).is_empty());
    let events = push(&mut assembler, 54, 10, true, &buffered);
    assert!(has_discontinuity(&events, HevcDiscontinuity::SequenceGap));
    assert!(access_units(events).is_empty());

    let recovered = nal(19, &[0x85]);
    let output = access_units(push(&mut assembler, 55, 11, true, &recovered));
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].bytes, length_prefixed(&[recovered]));
}

#[test]
fn timestamp_change_without_marker_requires_a_fresh_sync_sample() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 60);
    prime_parameter_sets(&mut assembler, 61);

    assert!(
        push(&mut assembler, 62, 20, false, &nal(1, &[1])).is_empty(),
        "an open access unit must not escape"
    );
    let predicted = nal(1, &[2]);
    let events = push(&mut assembler, 63, 21, true, &predicted);
    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::TimestampChangedWithoutMarker
    ));
    assert!(access_units(events).is_empty());

    let recovered = nal(19, &[0x82]);
    let output = access_units(push(&mut assembler, 64, 22, true, &recovered));
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].bytes, length_prefixed(&[recovered]));
}

#[test]
fn rejects_invalid_fu_and_reserved_payload_structures() {
    let invalid_payloads = [
        fu(1, true, true, &[1]),
        fu(1, false, true, &[1]),
        fu(1, true, false, &[]),
        vec![50 << 1, 1, 0],
        vec![1 << 1, 0, 1],
    ];

    for (index, invalid) in invalid_payloads.iter().enumerate() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        synchronize(&mut assembler, 100 + index as u16 * 2);
        let events = push(&mut assembler, 101 + index as u16 * 2, 30, true, invalid);
        assert!(
            has_discontinuity(&events, HevcDiscontinuity::MalformedPayload),
            "invalid case {index} was accepted"
        );
        assert!(access_units(events).is_empty());
    }
}

#[test]
fn rejects_incomplete_or_inconsistent_fu_chains_as_whole_access_units() {
    let cases = [
        (fu(1, true, false, &[1]), fu(2, false, true, &[2]), false),
        (
            fu(1, true, false, &[1]),
            {
                let mut changed_layer = fu(1, false, true, &[2]);
                changed_layer[1] = 9;
                changed_layer
            },
            false,
        ),
        (fu(1, true, false, &[1]), fu(1, true, false, &[2]), false),
        (fu(1, true, false, &[1]), fu(1, false, true, &[2]), true),
    ];

    for (index, (first, second, first_has_marker)) in cases.into_iter().enumerate() {
        let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
        let base = 150 + index as u16 * 4;
        synchronize(&mut assembler, base);
        prime_parameter_sets(&mut assembler, base + 1);

        let first_events = push(&mut assembler, base + 2, 31, first_has_marker, &first);
        let mut events = first_events;
        if !first_has_marker {
            events.extend(push(&mut assembler, base + 3, 31, true, &second));
        }

        assert!(
            has_discontinuity(&events, HevcDiscontinuity::MalformedPayload),
            "inconsistent FU case {index} was accepted"
        );
        assert!(access_units(events).is_empty());
    }
}

#[test]
fn enforces_nal_access_unit_and_nal_count_limits() {
    let nal_limits = DepacketizerLimits {
        max_nal_unit_size: SYNTHETIC_64_X_64_SPS.len(),
        max_nal_unit_count: 4,
        ..DepacketizerLimits::default()
    };
    let mut assembler = HevcAccessUnitAssembler::with_limits(PAYLOAD_TYPE, SSRC, nal_limits);
    synchronize(&mut assembler, 200);
    prime_parameter_sets(&mut assembler, 201);

    let oversized_body = vec![0; SYNTHETIC_64_X_64_SPS.len() - 1];
    let oversized_nal = nal(1, &oversized_body);
    let events = push(&mut assembler, 202, 40, true, &oversized_nal);
    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::NalUnitTooLarge
    ));

    let too_many = ap(&[
        nal(1, &[1]),
        nal(1, &[2]),
        nal(1, &[3]),
        nal(1, &[4]),
        nal(1, &[5]),
    ]);
    let events = push(&mut assembler, 203, 41, true, &too_many);
    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::TooManyNalUnits
    ));

    let access_unit_limits = DepacketizerLimits {
        max_access_unit_size: 24,
        ..DepacketizerLimits::default()
    };
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 300);
    prime_parameter_sets(&mut assembler, 301);
    assembler.limits = access_unit_limits;
    let first = nal(1, &[1, 2, 3, 4]);
    let second = nal(1, &[5, 6, 7, 8]);
    let third = nal(1, &[9, 10, 11, 12]);
    assert!(push(&mut assembler, 302, 42, false, &first).is_empty());
    assert!(push(&mut assembler, 303, 42, false, &second).is_empty());
    let events = push(&mut assembler, 304, 42, true, &third);
    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::AccessUnitTooLarge
    ));
    assert!(access_units(events).is_empty());

    let parameter_limits = DepacketizerLimits {
        max_parameter_set_size: SYNTHETIC_64_X_64_SPS.len(),
        ..DepacketizerLimits::default()
    };
    let mut assembler =
        HevcAccessUnitAssembler::with_limits(PAYLOAD_TYPE, SSRC, parameter_limits);
    synchronize(&mut assembler, 400);
    let original = prime_parameter_sets(&mut assembler, 401);
    let mut oversized_sps = SYNTHETIC_64_X_64_SPS.to_vec();
    oversized_sps.push(0);
    let oversized_parameter_set = ap(&[oversized_sps, nal(NAL_TYPE_PPS, &[0x30])]);
    let events = push(&mut assembler, 402, 43, true, &oversized_parameter_set);
    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::ParameterSetTooLarge
    ));
    assert_eq!(assembler.parameter_sets().unwrap(), original);
}

#[test]
fn reset_is_a_cancellation_barrier_for_partial_and_buffered_data() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 300);
    prime_parameter_sets(&mut assembler, 301);
    assert!(push(&mut assembler, 302, 50, false, &fu(1, true, false, &[1])).is_empty());
    assert!(push(&mut assembler, 304, 50, true, &fu(1, false, true, &[3])).is_empty());

    assembler.reset();
    assert!(assembler.parameter_sets().is_none());
    let events = push(&mut assembler, 303, 50, true, &fu(1, false, true, &[2]));
    assert!(has_discontinuity(
        &events,
        HevcDiscontinuity::MalformedPayload
    ));
    assert!(access_units(events).is_empty());
    assert!(
        push(&mut assembler, 304, 51, true, &nal(1, &[4])).is_empty(),
        "predicted frames must remain gated after reset"
    );

    prime_parameter_sets(&mut assembler, 305);
    let recovered = nal(19, &[0x85]);
    assert_eq!(
        access_units(push(&mut assembler, 306, 52, true, &recovered)).len(),
        1
    );
}

#[test]
fn rejects_packets_outside_the_negotiated_payload_and_source() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    let payload = nal(1, &[1]);

    let events = assembler.push_packet(&packet(99, SSRC, 1, 1, true, &payload));
    assert_eq!(
        events,
        vec![HevcDepacketizerEvent::PacketRejected(
            HevcPacketRejection::UnexpectedPayloadType
        )]
    );
    let events = assembler.push_packet(&packet(PAYLOAD_TYPE, SSRC + 1, 1, 1, true, &payload));
    assert_eq!(
        events,
        vec![HevcDepacketizerEvent::PacketRejected(
            HevcPacketRejection::UnexpectedSource
        )]
    );

    synchronize(&mut assembler, 1);
}

#[test]
fn parameter_set_revision_changes_only_when_committed_bytes_change() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 400);
    let first = prime_parameter_sets(&mut assembler, 401);
    assert_eq!(first.revision, 1);

    let identical = ap(&[
        nal(NAL_TYPE_VPS, &[0x10]),
        SYNTHETIC_64_X_64_SPS.to_vec(),
        nal(NAL_TYPE_PPS, &[0x30]),
    ]);
    assert!(push(&mut assembler, 402, 2, true, &identical).is_empty());
    assert_eq!(assembler.parameter_sets().unwrap().revision, 1);

    let changed = ap(&[
        nal(NAL_TYPE_VPS, &[0x10]),
        SYNTHETIC_96_X_64_SPS.to_vec(),
        nal(NAL_TYPE_PPS, &[0x30]),
    ]);
    assert!(push(&mut assembler, 403, 3, true, &changed).is_empty());
    assert_eq!(assembler.parameter_sets().unwrap().revision, 2);
}

#[test]
fn duplicate_and_late_packets_never_duplicate_access_unit_bytes() {
    let mut assembler = HevcAccessUnitAssembler::new(PAYLOAD_TYPE, SSRC);
    synchronize(&mut assembler, 500);
    prime_parameter_sets(&mut assembler, 501);

    let sample = nal(19, &[0x81]);
    let output = access_units(push(&mut assembler, 502, 4, true, &sample));
    assert_eq!(output.len(), 1);
    assert!(push(&mut assembler, 502, 4, true, &sample).is_empty());
    assert!(push(&mut assembler, 501, 2, true, &sample).is_empty());
}
