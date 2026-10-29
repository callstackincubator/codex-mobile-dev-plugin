use super::{
    HevcDiscontinuity, HevcParameterSets, NAL_TYPE_PPS, NAL_TYPE_SPS, NAL_TYPE_VPS, nal_type,
    sps::parse_sps_dimensions,
};

/// The last committed VPS/SPS/PPS bytes and the SPS-derived geometry.
#[derive(Debug, Default)]
pub(super) struct ParameterSetStore {
    video_parameter_set: Option<Vec<u8>>,
    sequence_parameter_set: Option<Vec<u8>>,
    picture_parameter_set: Option<Vec<u8>>,
    pixel_dimensions: Option<(u32, u32)>,
    revision: u64,
}

impl ParameterSetStore {
    /// Returns a copy of the latest complete parameter-set configuration.
    pub(super) fn snapshot(&self) -> Option<HevcParameterSets> {
        let (pixel_width, pixel_height) = self.pixel_dimensions?;
        Some(HevcParameterSets {
            revision: self.revision,
            pixel_width,
            pixel_height,
            video_parameter_set: self.video_parameter_set.clone()?,
            sequence_parameter_set: self.sequence_parameter_set.clone()?,
            picture_parameter_set: self.picture_parameter_set.clone()?,
        })
    }

    pub(super) fn is_complete(&self) -> bool {
        self.video_parameter_set.is_some()
            && self.sequence_parameter_set.is_some()
            && self.picture_parameter_set.is_some()
            && self.pixel_dimensions.is_some()
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
        let mut candidate_pixel_dimensions = None;
        for nal in nals {
            match nal_type(nal[0]) {
                NAL_TYPE_VPS => candidate_video_parameter_set = Some(nal.as_slice()),
                NAL_TYPE_SPS => {
                    candidate_pixel_dimensions = Some(parse_sps_dimensions(nal)?);
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
            self.pixel_dimensions = candidate_pixel_dimensions;
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
