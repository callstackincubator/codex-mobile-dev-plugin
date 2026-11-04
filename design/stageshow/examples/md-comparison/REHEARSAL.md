# Rehearsal: md-comparison

Gold: `ai-cards`. I kept the thread pinned at its foot, the earlier turns going up out of the window under a top mask, the card arriving in the thread with `Collapse reveal="drop"`, and the answered state kept as the record.
What changed:
- The ground is a white page with no plate. In the wide design the window now sits whole on the shared md-* frame (see Unify below). The compact design drops the window and uses the bare chat column with 16px gutters, because the window would have shown taller than wide at 358.
- The content is Mobile Dev's comparison card, taken from `packages/ui/src/components/comparison-card.tsx`:
  - the header icon (`ChartNoAxesCombined`) and "2 runs · Aligned at recording start · 30s timeline"
  - run chips bordered in `COMPARISON_COLORS` (blue, then orange)
  - the "CPU · %" track with stepped 1 s samples, and the blue ReferenceArea selection
  - the summary table's real columns and `seconds()`/`reading()` formats
- The earlier turn shows the before run's recording card ("HorseTinder card swiping · Finished"), drawn with the same samples as run 1.

Beats:
1. The request and the agent's answer sit in the chat.
2. The comparison card rises into the thread.
3. The "1. Before fix" line draws, then its row fills in.
4. The "2. After fix" line draws lower over it, then its row fills in.
5. The cursor drags 10.0s to 20.0s across the swipe burst. Range, Avg CPU and Memory change roll to the selection; Count rolls down where values fall.
6. Payoff holds for about 3 s: Peak CPU 22.7% vs 9.8% on the table.
7. Reset: the opening picture, as a copy, crossfades over the thread; the thread resets under it and hands back with no visible change.

The loop runs about 12 s.

Captured (before the unify pass):
- Wide 720x480 and compact 358x520, filmed at 390 and at 358.
- Light theme only.
- `--states`.
- Reduced-motion poster at both widths.
- Close-ups of the card drop (80ms), the drag (150ms), the roll (40ms) and the seam and handoff (40/60ms).

Film:
- `--gate` passes on the wide loop, at 390, at 358 and on `--states`.
- `manual: same-box content change mdc-svg`: this is the run lines drawing in (stroke-dashoffset). It is intended; checked in `card-drop.png` and `sheet.png`.
- `settle snap: ss-count__strip shifted 115-120px`: this is the kit Count putting its digit strip back in the middle decade after a roll (`data-snap`). The digit shown does not change, so it is invisible. It is kit behavior and was not changed.
- `near-empty frames ~11s`: this counts elements, and the opening picture (request, answer, earlier recording card) has fewer of them than the card. It is real content, on screen for about 1.8 s before the card arrives.
- Earlier `clipped` lines came from turns scrolled under the thread's deliberate top fade. The thread is marked `data-crop`, as `ai-cards` does.

Review (fresh-eye agent) and my responses:
1. "No chat in the poster": I made the stage 480 tall and tightened the card, so the black request bubble stays whole in the poster.
2. "Window shadow reads as a gray band on white": I replaced `--ss-shadow-hero` with a hairline plus a soft, even fall.
3. "Two gutters": the window is at 24/24 now.
4. "Empty band under compact card": the bottom gutter is now 16, equal to the sides.
5. "Crowded compact header": the compact table keeps Run / Peak CPU / Memory change.
6. "Rolls go the same way, units drift": the numeric cells are kit `Count`, which rolls by direction and keeps the unit in its own box; the unit gap is set to 0.
7. "Reset rewinds the thread": replaced by the crossfade under a copy, with no backward scroll.
8. "y 0 over x 0.0s": kept. The real recharts card draws the axes the same way (see `img/screenshot_performance.png`).

Assumptions:
- The data is invented and plausible: before peaks at 22.7%, after at 9.8%. Averages are computed from the samples. Memory change values are invented: 14.2/1.6 MiB for the whole runs, 6.8/0.4 MiB for the range.
- Table values update when the drag is released. The real card updates live during the drag; I avoided live churn.
- Chips are one line (title plus device and duration) and hug their content. The real chips are two lines and fill the grid. The bundle id is dropped.
- The window title "Fix card swipe lag" and the comparison title are what an agent would pass.


Not checked:
- Dark theme.
- Real-time playback feel in a real browser tab. I judged only from contact sheets on the virtual clock.
- Pause, resume and Replay in the playground viewer.
- The demo inside a real landing page host.

## Unify (shared md-* frame, UNIFY.md)

What changed:
- Stage is `STAGE` (960 x 540) from `../md-shared/frame`. The Window has `className="md-window mdc-win"`, so it sits whole at x 48, y 40, 864 x 460, with `--md-shadow-window`. I removed the old `.mdc-win` rule (inset 24/24, 760 x 500, off the right and bottom, its own shadow).
- Chrome: the kit Window's standard 38px bar with the lights and the title "Fix card swipe lag", as before.
- Chat column: 720 wide, centered in the 864 body (72px each side), the same column md-recording uses, so the two videos match. The thread is still pinned at its foot (402 tall in the 422 body). At the payoff the request bubble's top is 16px under the bar (md-recording's thread top is also 16) and the card ends 20px above the window's foot. The bubble, the answer and the whole card fit the body, and the earlier turns fade out under the 14px top mask.
- Plot: wide width 562 to 690 (the card's inner width at 720). Height stays 70, because the bubble and the card only just fit.
- Cursor: `REST.wide` is derived from `WINDOW` (x 876, y 424), in the right margin beside the card. The drag still measures `rect('plot')` and the plot geometry.
- `unframed` on the Stage: UNIFY.md asks for the window whole in an even gutter, which film's floating-window check otherwise flags as `framing:`. md-logs and md-recording do the same.
- The white surface moved from `.mdc-body` to the window body (`body={{ className: 'mdc-surface' }}`). Painted on `.mdc-body`, film read the body as a card with a 72px side inset and flagged a 34px bottom as `uneven padding:`. The picture is unchanged.
- Compact (358 x 520, the bare chat column) is untouched.

Gate:
- `--gate --width 1280`: `rehearsal passed`.
- `--gate --width 390`: `rehearsal passed`.
- Remaining lines, all as before: `settle snap` on `ss-count__strip` (kit Count re-centering), `near-empty frames ~11s` (the opening picture), `manual: same-box content change mdc-svg` (the line draw), and `jump: mdc-range width +2.2px` (the selection following the drag in 0.1 s steps; it is wider now because the plot is wider).
- `npx tsc --noEmit -p playground`: clean.

Files:
- Poster (reduced motion): `shots/md-comparison/unify-poster.png`.
- Loop sheets: `shots/md-comparison/unify-loop.png` and `unify-loop-390.png`.
- Video: `videos/md-comparison.mp4`, 1920 x 1080, 12.0 s, 720 frames. I checked frames at 0.1 s (opening), 4.6 s (both lines drawn, row 2 rolling in), 8.6 s (payoff, 10.0s-20.0s selected) and 11.9 s (matches the opening).
- `scripts/export-video.mjs` timed out here at its stage-size `waitForFunction`: under the virtual clock, page-side polling never fires. I exported with a temporary copy that polls from Node instead. The shared script was not edited.
