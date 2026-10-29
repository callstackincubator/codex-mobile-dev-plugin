// Jackson Coxson
//
// The host's `negotiatorOffer`s for the CoreDevice displayservice screen
// session: a binary plist carrying a zlib-compressed media blob and the host's
// `VCCallInfoBlob`.

use std::io::Write;

use flate2::{Compression, write::ZlibEncoder};

use super::{KEY_CALL_ID, KEY_MEDIA_BLOB, KEY_MODE, KEY_REMOTE_ENDPOINT_INFO};
use crate::media::protobuf::Encoder;
use crate::{CoreDeviceError, IdeviceError};

/// So we're using a different on than Device Hub, but this seems to stop screen tearing,
/// so we'll use this one instead.
const SCREEN_HEVC_FLS: &str =
    "FLS;MS:-1;LF:-1;LTR;CABAC;POS:0;EOD:1;HTS:2;RR:3;AR:16/9,5/8;XR:16/9,5/8;";

pub(super) const NEGOTIATOR_MODE_COREDEVICE_SCREEN: i64 = 5;
pub(super) const NEGOTIATOR_MODE_COREDEVICE_AUDIO: i64 = 6;

/// `VCCallInfoBlob` - endpoint metadata embedded (as protobuf) under
/// `avcMediaStreamOptionRemoteEndpointInfo` in the offer. Schema reversed from
/// `-[VCCallInfoBlob writeTo:]`.
#[derive(Debug, Clone, Default)]
pub struct CallInfoBlob {
    pub call_id: u32,
    pub client_version: u32,
    pub device_type: String,
    pub framework_version: String,
    pub os_version: String,
    pub device_name: Option<String>,
    pub audio_device_uid: Option<String>,
}

impl CallInfoBlob {
    pub(super) fn encode(&self) -> Vec<u8> {
        let mut e = Encoder::new();
        e.uint_field(1, u64::from(self.call_id));
        e.uint_field(2, u64::from(self.client_version));
        e.string_field(3, &self.device_type);
        e.string_field(4, &self.framework_version);
        e.string_field(5, &self.os_version);
        if let Some(n) = &self.device_name {
            e.string_field(6, n);
        }
        if let Some(u) = &self.audio_device_uid {
            e.string_field(7, u);
        }
        e.into_bytes()
    }
}

/// Build the CoreDevice screen-sharing media blob
pub(super) fn build_screen_media_blob(session_id: u32, ntp_time: u64) -> Vec<u8> {
    fn format_desc(e: &mut Encoder, variant: u64) {
        e.message_field(2, |m| {
            m.uint_field(1, 1);
            m.uint_field(2, variant);
            m.uint_field(3, 0xc3c3);
            m.uint_field(4, 0);
        });
    }

    let mut e = Encoder::new();
    e.uint_field(1, 1);
    e.uint_field(2, 1);
    e.message_field(5, |m| {
        m.uint_field(1, u64::from(session_id));
        m.uint_field(2, 0);
        // H.264 (RTP PT 123), four format descriptors.
        m.message_field(3, |c| {
            c.uint_field(1, 123);
            format_desc(c, 1);
            format_desc(c, 2);
            format_desc(c, 1);
            format_desc(c, 2);
            c.string_field(3, "FLS;SW:1;");
            c.uint_field(4, 1);
        });
        // HEVC (RTP PT 100), two format descriptors.
        m.message_field(3, |c| {
            c.uint_field(1, 100);
            format_desc(c, 1);
            format_desc(c, 2);
            c.string_field(3, SCREEN_HEVC_FLS);
            c.uint_field(4, 14);
        });
        m.uint_field(7, 1);
        m.uint_field(8, 63);
        m.uint_field(12, 1);
    });
    write_blob_tail(&mut e, ntp_time);
    e.into_bytes()
}

/// Build the CoreDevice screen-sharing audio media blob
pub(super) fn build_audio_media_blob(session_id: u32, ntp_time: u64) -> Vec<u8> {
    let mut e = Encoder::new();
    e.uint_field(1, 1);
    e.uint_field(2, 1);
    e.message_field(3, |m| {
        m.uint_field(1, u64::from(session_id));
        m.uint_field(2, 0);
        m.uint_field(3, 0);
        m.uint_field(4, 24_191);
        m.uint_field(5, 0);
        m.uint_field(6, 0);
    });
    write_blob_tail(&mut e, ntp_time);
    e.into_bytes()
}

/// Write the fields shared by the audio and video screen blobs: the UserAgent
/// (field 6), field 8, the bandwidth/parameter ladder (field 9, repeated), and
/// the trailing scalars (13 = NTP, 14, 16, 18).
fn write_blob_tail(e: &mut Encoder, ntp_time: u64) {
    fn param(e: &mut Encoder, id: u64, value: u64, flags: Option<u64>) {
        e.message_field(9, |m| {
            m.uint_field(1, id);
            m.uint_field(2, value);
            if let Some(f) = flags {
                m.uint_field(3, f);
            }
        });
    }
    e.string_field(6, "Viceroy 1.7.0");
    e.uint_field(8, 0);
    param(e, 0, 20_000_000, Some(0x18000));
    param(e, 4074, 0, Some(0x4000));
    param(e, 0, 60_000_000, Some(0x40000));
    param(e, 0, 40_000_000, Some(0x3000));
    param(e, 16, 4100, None);
    param(e, 0, 6_000_000, Some(0x20000));
    param(e, 4, 6500, None);
    param(e, 0, 100_000_000, Some(0x100000));
    param(e, 1, 299, None);
    param(e, 0, 75_000_000, Some(0x80000));
    e.uint_field(13, ntp_time);
    e.uint_field(14, 2);
    e.uint_field(16, 0);
    e.uint_field(18, 1);
}

/// zlib-compress a media blob into the form embedded in the offer plist.
pub(super) fn zlib_compress(raw: &[u8]) -> Result<Vec<u8>, IdeviceError> {
    let mut z = ZlibEncoder::new(Vec::new(), Compression::default());
    z.write_all(raw)
        .map_err(|e| CoreDeviceError::Negotiation(format!("zlib compress: {e}")))?;
    z.finish()
        .map_err(|e| CoreDeviceError::Negotiation(format!("zlib finish: {e}")).into())
}

/// Build the full `negotiatorOffer` for a device->host screen video stream:
/// a binary plist matching what Device Hub sends.
///
/// Keys:
/// - `avcMediaStreamOptionCallID`        - UUID string identifying the session
/// - `avcMediaStreamNegotiatorMediaBlob` - zlib-compressed screen media blob
/// - `avcMediaStreamNegotiatorMode`      - 5 (CoreDeviceScreenSharing; the audio
///   offer uses 6 / CoreDeviceSystemAudio
/// - `avcMediaStreamOptionRemoteEndpointInfo` - `VCCallInfoBlob` protobuf
pub fn build_screen_video_offer(
    call_id: &str,
    call_info: &CallInfoBlob,
    ssrc: u32,
) -> Result<Vec<u8>, IdeviceError> {
    let blob = build_screen_media_blob(ssrc, ntp_now());
    build_offer_plist(call_id, call_info, &blob, NEGOTIATOR_MODE_COREDEVICE_SCREEN)
}

/// Build the audio screen-sharing `negotiatorOffer`. Sent before the video
/// offer to establish the screen-sharing session.
pub fn build_screen_audio_offer(
    call_id: &str,
    call_info: &CallInfoBlob,
) -> Result<Vec<u8>, IdeviceError> {
    let session_id = uuid::Uuid::new_v4().as_u128() as u32;
    let blob = build_audio_media_blob(session_id, ntp_now());
    build_offer_plist(call_id, call_info, &blob, NEGOTIATOR_MODE_COREDEVICE_AUDIO)
}

/// Wrap a media blob into the binary-plist `negotiatorOffer`.
fn build_offer_plist(
    call_id: &str,
    call_info: &CallInfoBlob,
    media_blob_raw: &[u8],
    negotiator_mode: i64,
) -> Result<Vec<u8>, IdeviceError> {
    let media_blob = zlib_compress(media_blob_raw)?;

    let mut dict = plist::Dictionary::new();
    dict.insert(KEY_CALL_ID.into(), plist::Value::String(call_id.into()));
    dict.insert(KEY_MEDIA_BLOB.into(), plist::Value::Data(media_blob));
    dict.insert(
        KEY_MODE.into(),
        plist::Value::Integer(negotiator_mode.into()),
    );
    dict.insert(
        KEY_REMOTE_ENDPOINT_INFO.into(),
        plist::Value::Data(call_info.encode()),
    );

    let mut out = Vec::new();
    plist::to_writer_binary(&mut out, &plist::Value::Dictionary(dict))
        .map_err(|e| CoreDeviceError::Negotiation(format!("offer plist encode: {e}")))?;
    Ok(out)
}

fn ntp_now() -> u64 {
    const UNIX_TO_NTP: u64 = 2_208_988_800; // seconds between 1900 and 1970
    let now = web_time::SystemTime::now()
        .duration_since(web_time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() + UNIX_TO_NTP;
    let frac = (u64::from(now.subsec_nanos()) << 32) / 1_000_000_000;
    (secs << 32) | frac
}
