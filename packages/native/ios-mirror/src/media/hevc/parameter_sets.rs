use super::{
    HevcDiscontinuity, HevcParameterSets, NAL_TYPE_PPS, NAL_TYPE_SPS, NAL_TYPE_VPS, nal_type,
    sps::{SpsInfo, parse_sps},
};

/// The last committed VPS/SPS/PPS bytes and the format parsed from that SPS.
#[derive(Debug, Default)]
pub(super) struct ParameterSetStore {
    video_parameter_set: Option<Vec<u8>>,
    sequence_parameter_set: Option<Vec<u8>>,
    picture_parameter_set: Option<Vec<u8>>,
    sequence_info: Option<SpsInfo>,
    revision: u64,
}

impl ParameterSetStore {
    /// Returns a copy of the latest complete parameter-set configuration.
    pub(super) fn snapshot(&self) -> Option<HevcParameterSets> {
        let sps = self.sequence_info?;
        Some(HevcParameterSets {
            revision: self.revision,
            sps,
            video_parameter_set: self.video_parameter_set.clone()?,
            sequence_parameter_set: self.sequence_parameter_set.clone()?,
            picture_parameter_set: self.picture_parameter_set.clone()?,
        })
    }

    pub(super) fn is_complete(&self) -> bool {
        self.video_parameter_set.is_some()
            && self.sequence_parameter_set.is_some()
            && self.picture_parameter_set.is_some()
            && self.sequence_info.is_some()
    }

    /// Commits the parameter sets carried by a complete access unit. The
    /// revision advances when committed bytes change and the set is complete.
    pub(super) fn commit(
        &mut self,
        nals: &[Vec<u8>],
        max_parameter_set_size: usize,
    ) -> Result<(), HevcDiscontinuity> {
        if nals.iter().any(|nal| {
            matches!(nal_type(nal[0]), NAL_TYPE_VPS | NAL_TYPE_SPS | NAL_TYPE_PPS)
                && nal.len() > max_parameter_set_size
        }) {
            return Err(HevcDiscontinuity::ParameterSetTooLarge);
        }

        // Validate every candidate before mutating the committed snapshot. A
        // malformed changed SPS must not combine with new VPS/PPS bytes or
        // replace geometry from the last decoder-ready configuration.
        let mut candidate_video_parameter_set = None;
        let mut candidate_sequence_parameter_set = None;
        let mut candidate_picture_parameter_set = None;
        let mut candidate_sequence_info = None;
        for nal in nals {
            match nal_type(nal[0]) {
                NAL_TYPE_VPS => candidate_video_parameter_set = Some(nal.as_slice()),
                NAL_TYPE_SPS => {
                    candidate_sequence_info = Some(parse_sps(nal)?);
                    candidate_sequence_parameter_set = Some(nal.as_slice());
                }
                NAL_TYPE_PPS => candidate_picture_parameter_set = Some(nal.as_slice()),
                _ => {}
            }
        }

        let mut changed = false;
        if let Some(candidate) = candidate_video_parameter_set
            && self.video_parameter_set.as_deref() != Some(candidate)
        {
            self.video_parameter_set = Some(candidate.to_vec());
            changed = true;
        }
        if let Some(candidate) = candidate_sequence_parameter_set {
            if self.sequence_parameter_set.as_deref() != Some(candidate) {
                self.sequence_parameter_set = Some(candidate.to_vec());
                changed = true;
            }
            self.sequence_info = candidate_sequence_info;
        }
        if let Some(candidate) = candidate_picture_parameter_set
            && self.picture_parameter_set.as_deref() != Some(candidate)
        {
            self.picture_parameter_set = Some(candidate.to_vec());
            changed = true;
        }
        if changed && self.is_complete() {
            self.revision = self.revision.saturating_add(1).max(1);
        }
        Ok(())
    }
}
