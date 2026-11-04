# Rehearsal: md-recording

Gold: `ai-cards`. I kept its structure: one app window with a chat thread inside it, and a card arriving in the thread with `Collapse reveal="drop"`. Its button labels are layered in one cell and crossfade. I also borrowed `chart-scrub`'s pointer-driven readout (`a.move` with `onMove`) for the range drag. Changes from the gold:
- White page with no plate (brief). Wide is the shared md-* frame (`examples/md-shared`, see Unify below): a 960 x 540 stage, the window whole at 48/40.
- A new thread: one black user bubble at the top. It never moves.
- The card is Mobile Dev's own recording card, built from `packages/ui/src/components/recording-card.tsx` and `style.css`:
  - header with the status pill
  - CPU (step line, 0 to 100%) and Memory (MiB) tracks, each with its headline metric (Peak, Δ)
  - grid and axis ticks as in the product
  - purple change spans, and a blue range band with a stroke
  - right column: the "Entire recording"/"Selected range" minimap, Threads, and the black Ask button
- "Open in Mobile Dev" is left out. It only shows when the host can open the app, and the card would not fit with it.
- Compact (358 x 578): no desktop window, just the chat column on the page. The card stacks as the product does below its breakpoint, with the sidebar under one CPU track. The Memory track is dropped to keep the card whole.

Beats:
1. The card sits under the request as Recording, with empty charts. 0 to 0.4s.
2. The CPU and memory lines draw left to right over 4.6s. Peak, Δ and the thread shares roll at each of the three swipes. 0.4 to 5.2s.
3. The status swaps to Finished, and the purple spans fade in on both charts and the minimap. 5.2 to 6.5s.
4. The crosshair drags across the second swipe, 13.4s to 17.8s, with the blue band under it on both charts and the minimap. On release the minimap switches to "Selected range" with "Clear", and its labels roll to 13.4s and 17.8s. The thread shares roll to the range's values, and the button crossfades to "Ask about this range". 6.5 to 9.2s.
5. The pointer rests on the Ask button (hover) and then moves off. 9.2 to 12.8s.
6. Seam: the finished card leaves and the next recording's empty card drops into its place. The two slots are swapped back unseen, so the loop starts where it began and no data rewinds in view.

The loop is about 14.6s. The poster is beat 4 settled: Finished, spans, range selected, "Ask about this range".

Captured:
- Wide (1280 viewport) and 390, both loops at 600ms.
- `--states` at both widths.
- Reduced-motion posters at both widths.
- Close-ups at 40 to 80ms: card handoff at the seam, the range drag, the status pill swap, the rolling Peak and Δ.
- Light theme only; it is the only look shipped.

Film:
- `--gate` ends `rehearsal passed` on: the wide loop, the 390 loop, `--states` wide and 390, and both posters (`--still --reduced`).
- Remaining candidate lines, each checked against frames:
  - `settle snap: span.ss-roll__mid ... 8.2px`, wide only. This is the Δ Roll repartitioning when "-10 MiB" becomes "-11 MiB": the head grows from "-" to "-1", so the changed span's element moves one digit right. Frame by frame (`shots/md-recording/delta.png`), nothing visibly hops.
  - `vanishes with no exit: span.ss-swap__in "Recording" / "Entire recording"`. This is the kit `Swap` handing its old label to a fading copy. At 40ms the label blurs out and the new one fades in; no frame shows a pop.
  - `near-empty frames ... 13.x s for about 150ms`. This is the seam: the outgoing card dims before the incoming one fades in. I tried overlapping them, but the two cards' text onion-skinned, which was worse, so I reverted it.
- Earlier failures, all fixed:
  - one gutter
  - onion-skin fills in the minimap (now opaque tints, with marks merged)
  - uneven padding, and uneven gutters from bordered containers (now rule elements)
  - a narrow-window shape in compact (no window now)
  - an empty pane at the opening (the card is present from frame one)
  - `selection drift` from a crosshair `a.drag` (now `a.move` with `onMove`, since this is a plot range, not a text selection)

Review:
- First fresh-eye pass:
  - The card replaced the chat, with the bubble scrolled away. I made the stage taller, anchored the thread at the top and kept the bubble visible.
  - Opening and seam frames held only placeholders. I removed the placeholder turns; the card is present from the start and the seam hands one card to the next.
  - "Ask looks pressed, then the card vanishes": the pointer now leaves the button before the exit.
  - Status pill and range heading clipping while they swap: they now use `Swap` (masked edge), and Clear fades in after the heading.
  - Black bubble: kept, because the brief asks for it.
  - Memory dropped in compact: kept, and stated above.
  - Units detaching during the Roll: this is kit `Roll` behaviour (the width opens, then the digits roll) and is left as is.
  - Heavy left shadow: this is the kit hero shadow every gold uses, so it stays.
- Second pass:
  - The seam's near-empty frame and Roll unit spacing: see above.
  - The cursor resting on the bottom-right corner: it now rests on empty surface in the body's right margin beside the chat column (wide) and beside the bubble (compact).
  - (The earlier "heavy left shadow" and "fake bleed" notes no longer apply: the window now uses the shared `--md-shadow-window` and sits whole.)

Assumptions:
- Values are invented but plausible and consistent with the screenshot: Peak 22.7%, Δ -11 MiB, threads 2.8/2.4/0.3%, and range values of 9.6/8.1/1.1%.
- The card's subtitle and the thread names match the screenshot.
- Live readouts step at each swipe; in the product they update as samples arrive.

Unresolved:
- Compact omits the Memory track.
- The rolling unit gap is inherent to the kit's `Roll`.

Not checked:
- Real-time playback in the playground viewer (pause, resume, Replay).
- Return from offscreen.
- Toggling reduced motion during playback.
- The 358 width exactly; 390 was filmed.
- Other looks (dark).
- Touch devices.

## Unify (shared md-* frame, UNIFY.md)

What changed (wide only; compact is untouched apart from the sidebar gap):
- Stage `STAGE` (960 x 540). The kit `Window` has `md-window`, so it sits whole at 48/40, 864 x 460, with `--md-shadow-window` and the standard 38px bar ("Profile card swipe lag"). Removed the old `.mr-win` inset, size, bleed and hero shadow.
- `unframed` on the Stage: the spec keeps the window whole with even air, which film's "floats whole" framing line flags as never-intentional. The prop only stands that check down; it changes no rendering.
- Chat column: 720 wide, centered in the 864 body (72 each side), 16 from the body top. Request bubble right-aligned at the column edge, 16 below it the card, whose foot sits 16 above the body foot (bubble 94-128, card 144-484 in stage px; body 78-500). Same insets md-comparison is expected to use.
- Card re-laid for the width: chart tracks 470 wide (was 390) with 75px plots (was 78), the sidebar gap 6 (was 8) so the two columns are equal height (276) and the card fits the 422 body with no empty band. Sidebar stays 216; the long thread name still wraps, as the product's `overflow-wrap: anywhere` does.
- Cursor: `REST` constant (876, 300) for both the Stage's `at` and the move-off before the exit, on empty body surface right of the column. The drag and the Ask move already use `rect('plot-cpu')` and `at: 'ask'`.
- Swap labels on screen from the first frame no longer fade in on mount (`.ss-swap__in:only-child { animation: none }`): the exported video opens on that frame and repeats, and the pill and the minimap heading blinked at each repeat. Real swaps still crossfade (checked frame by frame at 5.0 to 5.8s).

Gate results:
- `--gate --width 1280`: rehearsal passed (lines left: the Δ Roll settle snap, the Swap hand-off "vanishes", the 150ms seam dip; all as before).
- `--gate --width 390`: rehearsal passed.
- `--still --reduced --gate` at 1280 and 390: rehearsal passed, no issues.
- `npx tsc --noEmit -p playground`: clean.

Video: `videos/md-recording.mp4`, exported with `scripts/export-video.mjs` as checked in (after its virtual-clock fix): 1920 x 1080, 843 frames (14.05s). Frames checked at the start (0.05s), 3.5s (lines drawing), 9.0s (payoff: range selected, Ask about this range) and the seam. The first and last frames match (PSNR 50.8 dB), so the repeat is seamless.

Shots: `shots/md-recording/unify-loop.png`, `unify-loop-390.png`, `unify-poster.png`, `unify-poster-390.png`, `unify-video-0.05.png`, `unify-video-3.5.png`, `unify-video-9.0.png`.
