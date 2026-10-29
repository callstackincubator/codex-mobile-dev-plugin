use super::*;

#[test]
fn payload_parser_is_bounded_and_panic_free_for_arbitrary_bytes() {
    let mut state = 0x51a7_9e3du32;
    for length in 0..=512 {
        let mut bytes = vec![0; length];
        for byte in &mut bytes {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            *byte = state as u8;
        }

        let mut assembler = PayloadAssembler::new(128, 8);
        if let Ok(nals) = assembler.process(1, &bytes) {
            assert!(nals.len() <= 8);
            assert!(nals.iter().all(|nal| nal.len() <= 128));
        }
    }
}
