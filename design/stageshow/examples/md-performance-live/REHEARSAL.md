# Rehearsal: md-performance-live

Gold: `chart-scrub` (folder copied; kept the hairline that follows the pointer, the
one-stroke move onto the plot, the fade where the pointer leaves). The layout follows
`device-pair`: the window inset top-left and off the bottom, a phone straddling its
right edge, present from frame one. Replaced the look and content with Mobile Dev's
Performance panel: the product toolbar in the window bar, the header with bundle ID, status and
Start/Stop, the mono ruler, three tracks (label column with Current / Avg / Max /
Min or Threads, step areas for CPU and Memory, a line for Display FPS), the blue
hairline, the ruler time pill and the CPU tooltip, all taken from
`packages/ui/src/components/performance*`.

Beats: 1 the panel is Stopped on the last run, and Start clears it as the status
crossfades to Live · 2 FPS, CPU and Memory stream in from 00:00 on one timeline,
Current rolling each sample · 3 the cursor drags the HorseTinder card on the
mirrored phone, and CPU climbs to 86.4%, FPS dips to 38.4, Memory steps up, the card
springs back · 4 the cursor comes onto the spike, and the hairline crosses all three
tracks, the pill reads 00:07.450 and the tooltip reads 86.4 % · payoff holds, then Stop. The loop
runs about 12.6 s and opens on that stopped run.

Compact (358 × 340): the window whole across and off the bottom, with two stats per
track and a 20 s view. The phone is dropped, because a whole window must stay at
least 1.25:1 and a bled one at least square, and the tracks need 300 px. The cursor
waits on the header's empty middle while the spike streams in.

Captured: wide at 1280 and compact at 390 (contact-1280.png, contact-390.png), with
`--gate` passing on both. Also `--states --gate` at both widths (states.png,
states-390.png), the reduced-motion poster at both (poster.png, poster-390.png), the
drag slowed 4x (drag.png), the stats slowed 3x (stats.png), and the start beat
(start.png). Light theme only.

Film:
- `settle snap` / `handoff shift` on `ss-count__strip` → contact sheets → this is Count's
  decade homing between samples, which come every 500 ms. The glyphs are identical, and no hop shows in stats.png at 3x.
- `appears with no entrance: span.ss-count` → states sheet only → not found by a
  MutationObserver probe (no Count is ever added), so it stands as a candidate.
- `jump: ml-hair` at stop → the hairline follows the pointer leaving fast toward
  Stop, as the product's cursor indicator does.
- `clipped: ml-card__name` during the drag → the card leaving the phone's screen, the
  real clip.
- `near-empty frames` around 1.0 s → the cleared tracks between Start and the first
  sample; this is the product's empty state, for about 0.7 s.
- `manual: same-box content change` on the pill → the pill reads the pointer's time
  every frame, as the product does.

Review (fresh eye): compact has no phone → kept, for the window-shape reason above.
The run stopped short of the phone → view 28 s and poster at sample 18, so the data
now meets the phone. The 24 px strip under Memory → kept: it is a full gutter, and
cropping through Memory would cut its stats. The shadow side bands → kept, since
`--ss-shadow-hero` is the shared figure shadow. The card was the heaviest mark → it is lighter
and lower contrast now. The pill collided with tick labels → a covered label fades.
The swipe never lands → kept: the springback keeps the loop honest with no rewind
of the deck. Numbers rolled the wrong way → they are `Count` now, so they roll up and down by
direction, quick, and rest between samples. The status wiped to "pped" → it is `States` now. The back card's lip
was tight above the buttons → there is more gap, and the drag tilts less and lifts.

Assumptions: the device mirror in Mobile Dev takes mouse input, so the arrow drags
the card (no touch cursor). Display FPS needs a physical device, and the picker reads
"iPhone 17 Pro · iOS 26.3". The live view is drawn as 28 s wide (the product uses
30 s) so the run meets the phone. Samples land every 0.5 s, 2x real time.

Unresolved: Count candidates above. The top-right corner above the phone is open
ground, as in `device-pair`.

Not checked: dark theme, other looks, a real touch device, live rAF pacing on a
host page, pause/resume and offscreen return in the viewer.

## Unified frame (UNIFY.md)

The wide design is now the shared md-* frame (`examples/md-shared/frame.ts`):
the stage is 960 × 540, the window is `md-window` (whole at 48, 40, 864 × 460 with
`--md-shadow-window`), and the phone is `md-overlay-phone` at `OVERLAY_PHONE.width`
(214), placed by the frame. The old inset, height, hero shadow and phone position
in the wide layout are gone. The Stage is `unframed`, as in the other md-* scenes,
because the spec asks for the window whole with even gutters. Compact is unchanged.

Re-lay for the 864 × 422 body: header 46, ruler 25, three tracks of 117. The label
column is 210 wide and the metrics are 11 px, with Avg and Max on their own rows
(Current / Avg / Max / Min, or Threads for CPU), so the taller label column fills
without a gap. The view is the product's real 30 s. The phone covers the window from
window x 642, so:
- the 19 s run ends at about window x 624, 18 px short of the phone, and the poster
  run (18 samples) ends sooner;
- the 20 s grid line lands about 3 px under the phone's edge, and a ruler label
  appears only when it fits in the clear width (`clear`), so 5, 10 and 15 s show;
- the bar's Home / Camera / Pointer and the header's status, Start/Stop and settings
  end 14 px before the phone (a 236 px right inset), so nothing the story uses sits
  under it. The phone covers only the timeline's empty future.

The phone is whole now, so the HorseTinder card is taller (556 pt) and runs down to
the buttons, and the back card's lip is kept. The drag tilt is lower (0.02°/pt) and
the name sits 42 pt up, so the tilted tall card doesn't read as uneven padding.
Cursor moves are still all measured (`card`, `screen`, `toggle`, `cpu-plot`,
`fps-plot`, `mem-plot`, `phone`); no coordinates are hard-coded.

Gate: compact at 390 ends `rehearsal passed`. Wide at 1280 fails on one line only,
`framing: satellite div.ss-phone sits 34px from the bottom edge where the gutter is
40px`. This comes from the spec: the shared OVERLAY_PHONE box (y 56, 214 wide) puts
the phone's bottom at y 506, and the spec says not to position the phone myself. The
other wide film lines are the Count candidates listed above and the tooltip changing
width as the pointer leaves for Stop (it reads the sample under the pointer while it
fades).

Captured: shots/md-performance-live/unify-loop.png and unify-loop-390.png (gate),
unify-poster.png (the plain `--still`, which films just after Start rather than the
poster), unify-poster-reduced.png (the real poster), unify-poster-390.png,
unify-drag.png, unify-start.png, and videos/md-performance-live.mp4 (1920 × 1080,
11.88 s). I checked frames at 0.3 s, 4.6 s and 8.6 s.
