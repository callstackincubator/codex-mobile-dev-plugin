// The one frame every Mobile Dev feature preview shares, so the seven videos
// cut together: the same 16:9 stage, the same window box and shadow, the same
// device pane and overlay phone. Import the CSS once with these constants.
// No index.tsx here, so the playground does not list this folder.
import './frame.css'

/** The wide design: 16:9, exported at 2x as 1920 × 1080. */
export const STAGE = { width: 960, height: 540 } as const

/** The main window, whole inside the stage with an even gutter: 48 at the
 *  sides, 40 above and below. Its shadow fades out inside that gutter. */
export const WINDOW = { x: 48, y: 40, width: 864, height: 460 } as const

/** A device pane docked on the window's right (logs, storage, annotate; each
 *  of the two panes in simulators): the pane's width, and the phone at this
 *  width, centered in the pane both ways (about 390 tall in a 422 tall body). */
export const DEVICE_PANE = { width: 300, phone: 190 } as const

/** A phone overlaid in front of the window's right side: same box in
 *  every scene that has one. Whole inside the stage, shadow included. */
export const OVERLAY_PHONE = { x: 690, y: 50, width: 214 } as const
