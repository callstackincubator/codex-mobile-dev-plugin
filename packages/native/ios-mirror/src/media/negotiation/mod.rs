// Jackson Coxson
//
// VCMediaNegotiationBlobV2 - the AVConference media-negotiation blob carried as
// the `negotiatorOffer` (and returned as the device's answer) by the CoreDevice
// displayservice.
//
//     negotiatorOffer = zlib( protobuf( VCMediaNegotiationBlobV2 ) )
//
// Schema + field numbers are in `media_negotiation.proto` (reverse-engineered
// from AVConference). We only model the messages needed for a device->host
// video (screen) stream: `offer` writes the host's offers, `answer` selects the
// device's HEVC sender, and `schema` strictly decodes the uncompressed answer.

mod answer;
mod offer;
mod schema;
#[cfg(test)]
mod tests;

pub use answer::parse_screen_video_answer;
pub use offer::{CallInfoBlob, build_screen_audio_offer, build_screen_video_offer};

const KEY_CALL_ID: &str = "avcMediaStreamOptionCallID";
const KEY_MEDIA_BLOB: &str = "avcMediaStreamNegotiatorMediaBlob";
const KEY_MODE: &str = "avcMediaStreamNegotiatorMode";
const KEY_REMOTE_ENDPOINT_INFO: &str = "avcMediaStreamOptionRemoteEndpointInfo";
const MAX_NEGOTIATOR_MEDIA_BLOB_SIZE: u64 = 1024 * 1024;
