// Jackson Coxson
//
// Minimal protobuf wire-format encoder/decoder.
//
// The AVConference media-negotiation blob (`VCMediaNegotiationBlobV2`) is an
// Apple protobuf message. The schema is tiny and fixed (see
// `media_negotiation.proto`), so rather than pull in `prost`/`protoc` we
// hand-roll just the bits of the wire format we need.
//
// Wire types we handle: 0 = varint, 2 = length-delimited (string/bytes/message).
// Fixed 64-bit (1) and 32-bit (5) fields are skipped; group and reserved wire
// types are malformed.

const WIRE_VARINT: u64 = 0;
const WIRE_FIXED64: u64 = 1;
const WIRE_LEN: u64 = 2;
const WIRE_FIXED32: u64 = 5;
const MAX_FIELD_NUMBER: u64 = (1 << 29) - 1;

/// A growable protobuf encoder.
#[derive(Debug, Default)]
pub struct Encoder {
    buf: Vec<u8>,
}

impl Encoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }

    fn write_varint(&mut self, mut v: u64) {
        loop {
            let mut byte = (v & 0x7f) as u8;
            v >>= 7;
            if v != 0 {
                byte |= 0x80;
            }
            self.buf.push(byte);
            if v == 0 {
                break;
            }
        }
    }

    fn write_tag(&mut self, field: u32, wire: u64) {
        self.write_varint((u64::from(field) << 3) | wire);
    }

    /// Write a varint scalar field (uint32/uint64/bool/enum).
    pub fn uint_field(&mut self, field: u32, v: u64) {
        self.write_tag(field, WIRE_VARINT);
        self.write_varint(v);
    }

    /// Write a length-delimited field (string/bytes).
    pub fn bytes_field(&mut self, field: u32, v: &[u8]) {
        self.write_tag(field, WIRE_LEN);
        self.write_varint(v.len() as u64);
        self.buf.extend_from_slice(v);
    }

    pub fn string_field(&mut self, field: u32, v: &str) {
        self.bytes_field(field, v.as_bytes());
    }

    /// Write a nested message field by encoding `f` into a sub-encoder.
    pub fn message_field(&mut self, field: u32, f: impl FnOnce(&mut Encoder)) {
        let mut sub = Encoder::new();
        f(&mut sub);
        let bytes = sub.into_bytes();
        self.bytes_field(field, &bytes);
    }
}

/// The buffer is not a complete, well-formed protobuf message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Malformed;

/// One decoded protobuf field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field<'a> {
    Varint(u64),
    Len(&'a [u8]),
}

/// Narrows a varint to a `uint32` field value, rejecting values that would
/// otherwise be silently truncated.
pub fn uint32(value: u64) -> Result<u32, Malformed> {
    u32::try_from(value).map_err(|_| Malformed)
}

/// Checks that `message` is a complete sequence of well-formed fields without
/// interpreting them.
pub fn check_framing(message: &[u8]) -> Result<(), Malformed> {
    Decoder::new(message).try_for_each(|field| field.map(|_| ()))
}

/// A strict protobuf decoder over a borrowed buffer.
///
/// Iteration yields every field in order and ends after the last byte. A
/// truncated field, an overlong varint, an invalid field number or an
/// unsupported wire type yields one `Err(Malformed)` and ends the iteration,
/// so a message only decodes successfully when every byte was consumed.
#[derive(Debug)]
pub struct Decoder<'a> {
    buf: &'a [u8],
    pos: usize,
    failed: bool,
}

impl<'a> Decoder<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0, failed: false }
    }

    fn read_varint(&mut self) -> Result<u64, Malformed> {
        let mut result: u64 = 0;
        let mut shift = 0;
        loop {
            let byte = *self.buf.get(self.pos).ok_or(Malformed)?;
            self.pos += 1;
            if shift == 63 && byte > 1 {
                return Err(Malformed);
            }
            result |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(result);
            }
            shift += 7;
            if shift >= 64 {
                return Err(Malformed);
            }
        }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], Malformed> {
        let end = self.pos.checked_add(len).ok_or(Malformed)?;
        let slice = self.buf.get(self.pos..end).ok_or(Malformed)?;
        self.pos = end;
        Ok(slice)
    }

    /// Reads one field; fixed-width fields are consumed and reported as `None`.
    fn read_field(&mut self) -> Result<Option<(u32, Field<'a>)>, Malformed> {
        let tag = self.read_varint()?;
        let number = tag >> 3;
        if number == 0 || number > MAX_FIELD_NUMBER {
            return Err(Malformed);
        }
        let number = number as u32;
        match tag & 7 {
            WIRE_VARINT => Ok(Some((number, Field::Varint(self.read_varint()?)))),
            WIRE_LEN => {
                let len = self.read_varint()?;
                let len = usize::try_from(len).map_err(|_| Malformed)?;
                Ok(Some((number, Field::Len(self.take(len)?))))
            }
            WIRE_FIXED64 => self.take(8).map(|_| None),
            WIRE_FIXED32 => self.take(4).map(|_| None),
            _ => Err(Malformed),
        }
    }
}

impl<'a> Iterator for Decoder<'a> {
    type Item = Result<(u32, Field<'a>), Malformed>;

    fn next(&mut self) -> Option<Self::Item> {
        while !self.failed && self.pos < self.buf.len() {
            match self.read_field() {
                Ok(Some(field)) => return Some(Ok(field)),
                Ok(None) => continue,
                Err(error) => {
                    self.failed = true;
                    return Some(Err(error));
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(bytes: &[u8]) -> Result<Vec<(u32, Field<'_>)>, Malformed> {
        Decoder::new(bytes).collect()
    }

    #[test]
    fn roundtrip_scalars_and_message() {
        let mut e = Encoder::new();
        e.uint_field(1, 100);
        e.string_field(2, "abc");
        e.message_field(7, |m| {
            m.uint_field(1, 4);
            m.bytes_field(2, &[0xde, 0xad]);
        });
        let bytes = e.into_bytes();

        let fields = decode(&bytes).unwrap();
        assert_eq!(fields[0], (1, Field::Varint(100)));
        assert_eq!(fields[1], (2, Field::Len(b"abc")));
        let (7, Field::Len(nested)) = fields[2] else { panic!("expected a nested message") };
        assert_eq!(decode(nested), Ok(vec![(1, Field::Varint(4)), (2, Field::Len(&[0xde, 0xad]))]));
        assert_eq!(fields.len(), 3);
    }

    #[test]
    fn skips_fixed_width_fields() {
        let bytes = [0x09, 1, 2, 3, 4, 5, 6, 7, 8, 0x15, 1, 2, 3, 4, 0x18, 0x05];
        assert_eq!(decode(&bytes), Ok(vec![(3, Field::Varint(5))]));
    }

    #[test]
    fn rejects_an_overflowing_tenth_varint_byte() {
        let mut wire = vec![0x08];
        wire.extend_from_slice(&[0x80; 9]);
        wire.push(0x02);
        assert_eq!(decode(&wire), Err(Malformed));
    }

    #[test]
    fn rejects_truncation_unsupported_wire_types_and_invalid_field_numbers() {
        let malformed: [&[u8]; 7] = [
            &[0x08],
            &[0x08, 0x80],
            &[0x12, 0x02, 0x01],
            &[0x09, 1, 2, 3],
            &[0x0b],
            &[0x00, 0x01],
            &[0x80, 0x80, 0x80, 0x80, 0x10, 0x00],
        ];
        for bytes in malformed {
            assert_eq!(decode(bytes), Err(Malformed), "{bytes:02x?}");
            assert_eq!(check_framing(bytes), Err(Malformed));
        }
    }

    #[test]
    fn stops_after_the_first_malformed_field() {
        let mut decoder = Decoder::new(&[0x08, 0x01, 0x0b, 0x08, 0x02]);
        assert_eq!(decoder.next(), Some(Ok((1, Field::Varint(1)))));
        assert_eq!(decoder.next(), Some(Err(Malformed)));
        assert_eq!(decoder.next(), None);
    }

    #[test]
    fn uint32_rejects_truncating_values() {
        assert_eq!(uint32(u64::from(u32::MAX)), Ok(u32::MAX));
        assert_eq!(uint32(1 << 32), Err(Malformed));
    }
}
