# Rehearsal: md-logs

## Unify pass (shared md frame)

The wide design now sits on `examples/md-shared/frame`, as the shared frame spec (`../md-shared/frame.ts`) asks:
- Stage `STAGE` (960 x 540). The Window has `md-window` (whole at 48, 40, 864 x 460, `--md-shadow-window`). Its own position, size and shadow rules are gone, and so is the bleed off the right.
- `unframed` is set on the Stage. The shared frame is a whole window with even gutters, which is the developer's call. Without it, film's framing check fails the gate with `floats whole ... 48/48/40/40px of air` (the window covers 77% of the stage, and the check wants 82%).
- The device column is `md-device-pane` (300 wide). It centers a `DEVICE_PANE.phone` (190) simulator both ways: 399.5 tall, with 11px above and below in the 422 body.
- Logs take the rest of the body (564). The filler bars are scaled to the wider message column (`COL.wide` 450). The details are 333 tall, the split under the toolbar less the error row, so no band opens between the row and the details. The stack trace gains a third frame (`onPress`, `LikeButton.tsx:18:5`) so its space above Fix in chat matches the old layout.
- Error row message: `text-wrap: balance`. At 564 the badge's padding would otherwise move "TypeError:" between lines when the log stacks. Balanced, it breaks after "like:" with or without the badge (probed, wide and compact).
- Cursor: `REST.wide` is now (568, 474), on empty surface right of Fix in chat at the payoff. The other moves use `data-target`. The esc keycap is at `bottom: 52px`, level with Fix in chat.
- The row is opened a little sooner after typing (a 420ms move instead of 520) to shorten the one-row transitional frame.
- Compact is unchanged.

Unify checks:
- `--gate` at 1280 and at 390 both end `rehearsal passed` (`shots/md-logs/unify-loop.png`, `unify-loop-390.png`). The remaining findings are the same judged candidates listed below.
- Posters: `unify-poster.png` (opening), `unify-reduced.png` (reduced-motion poster), `unify-payoff.png`, `unify-badge.png`, `unify-reset.png` (reset sheet), `unify-poster-390.png`.
- Video: `videos/md-logs.mp4`, 1920 x 1080, 60 fps, 14.8 s. I checked frames at 0.3 s (opening), 7.4 s (filtered to the error) and 10.0 s (payoff). The last frame matches the opening.
- `npx tsc --noEmit -p playground`: clean.

## Original build

Gold: `hero-demo`, whose folder was copied. I kept its animated hero, the real macOS cursor walking named targets, typed text, the `compact` at 358 and the poster on the payoff. Everything else is new. The layout follows the product's own side-by-side workspace (`img/screenshot_side_by_side.png`): logs on the left, the device column on the right. `device-pair` informed the compact pairing of a phone and a panel. Unlike both golds, there is no well, because the brief asks for a white page.

Beats:
1. LIKE is clicked on the simulator. A red `[recordLike]` error row arrives at the bottom of the live list.
2. LIKE is clicked twice more. The row stacks: its badge appears and rolls from 2 to 3, and the timestamp rolls from :48 to :50.
3. "recordLike" is typed into Filter logs... and the list closes around the error in a cascade.
4. The row is clicked. Its details open under it: Time, Message, Stack trace (wide only) and Fix in chat.
5. Payoff, held about 2.4 s.

Reset: Escape in the search clears it. Logs that streamed in while the filter was on reopen beneath the error and carry it out of view. The details are then closed with their X. The rows left in view belong to the same filler cycle as the opening, so swapping back to the opening list (under `data-snap`) is invisible. The loop is about 15.5 s.

Captured:
- Wide loop: `shots/md-logs/sheet.png`
- 390: `sheet-390.png`
- 358: `sheet-358.png`
- States, wide and 390: `states.png`, `states-390.png`
- Reduced-motion posters: `poster.png`, `poster-390.png`
- Reset at 100 ms: `reset.png`
- Mid-story still: `mid.png`
- Light look only; the brief names only light.

Film:
- `--gate` ends `rehearsal passed` on the wide loop, 390, 358, `--states` wide and `--states` 390.
- Fixed along the way:
  - `uneven gutters` on the compact message box: the details body padding is now 12px.
  - `tight control` from rows scrolled out above the list: a viewport hides rows wholly past its top, as the product's virtualized list does.
  - `uneven inset` from the badge padding reserved at count 1: the padding now opens when the log stacks, and the pane is 500px so the message wraps the same either way.
  - `hard edge` on rows scrolling out: there is a 22px top mask while the list overflows.
  - A framing failure on a whole compact window: compact is now a chromeless panel card over the phone's foot.
- Remaining candidates, judged:
  - `jump`/`settle snap` on `ss-count__strip`. This is the kit Count re-centring its digit strip after a roll, and it is invisible.
  - `jump: ss-field__chars` while typing. This is per-keystroke typing and is intentional.
  - `appears with no entrance` / `vanishes with no exit` on `div.mdl-list` and on rows. These come at the seam swap (identical frames: compare `sheet.png` 15.2 s with 16.0 s) and from rows un-hidden by the viewport as they slide in under the top mask.
  - `settle snap` of 1.1px on list rows. I could not locate it. A probe of the track height found only 0.02px end-of-Collapse rounding. It is unresolved but not visible in any sheet.

Review (fresh eye):
1. The window shadow was cut flat by the stage. Fixed: a shorter hero shadow fades inside the 20px gutter, and a 14px one on the compact card. (Superseded: wide now uses the shared `--md-shadow-window`.)
2. The wide window bleeds only off the right. (Superseded: the window is now whole on the shared frame.) Originally this stood. The list follows new logs at its foot, so the foot (where every new row lands) must stay in frame. A bottom bleed would hide the story's arrivals.
3. The compact panel has no bleed. This stands for the same reason. The phone runs off the top, the panel overlaps its foot, and the gate's framing checks pass at 390 and 358.
4. The compact phone loses its status bar and app name. This stands. It follows framing.md: a phone cropped at the top loses its status bar and nav together, and the crop falls inside the content (Monty's card).
5. The list was all bars and native versus Metro was not visible. Fixed: filler rows now carry the product's real prefixes, `com.upo.horsetinder:` (native process) and `horsetinder:` (Metro tag). Messages stay bars.
6. There was a void after filtering. Reduced: the row is opened straight after typing (about 0.6 s plus the details' open). It is still a brief transitional frame.
7. The reset had two causes in odd order and a "double image" as the details close. Kept: Escape clears the search (real behaviour for a search input), and the X closes the details, which persist on the selected log as in the product. The close is the kit Collapse dissolve while the list grows into the space (`reset.png` 1.1 s to 1.2 s).
8. The esc keycap crossed the window edge. Fixed: the keycaps sit inside the panel, beside Fix in chat.

Assumptions:
- LIKE fails three times, so the log stacks and the count reaches 3.
- The first stack frame is `src/api/recordLike.ts:14:28` (the screenshot's chat fixes recordLike.ts).
- The device toolbar sits in the window's unified bar.
- The third stack frame (`onPress` in `LikeButton.tsx`) is invented, like the other two.

Unresolved: the 1.1px settle-snap candidate above.

Not checked:
- Dark theme (not shipped).
- Real-browser rAF pacing outside the film's virtual clock.
- Pause, resume and Replay in the playground viewer.
- A host page other than the playground.
- Touch input.
