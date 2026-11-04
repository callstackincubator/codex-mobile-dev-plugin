# Rehearsal: md-annotate

## Phone (shared HorseTinder)

Per `PHONE.md`, the phone runs `examples/md-shared/HorseTinder.tsx` in both layouts:
- `<HorseTinderPhone>` at `DEVICE_PANE.phone` (wide) and 270 (compact), time 17:44, `phoneClassName="ma-phone"`. The example's own app markup and every `.ht*` rule (logo, card, drawn subject, info, tags, buttons, labels, wallpaper, fonts) are gone.
- Targets through the props: `card={{ 'data-target': 'card' }}` and `buttons.carrot` gets `data-target="carrot"`, so the annotation now picks the whole Mega Carrot button (it used to be the carrot glyph inside it). `data-cursor="crosshair"` goes on the Phone through `phoneProps` while the pointer tool is on.
- The cursor moves to a point on the carrot instead of targeting it. In select mode the overlay takes the click, so the app's button does not press. Targeting the button set `data-pressed`, the shared `scale: 0.9` shrank `rect('carrot')`, and the note field jumped 3px as it opened (compact gate line `jump ... at pick`).
- The pin sits on the button's lower right corner and the field is centered on it in both layouts. The field opens 4px (wide) / 5px (compact) right of the button and ends 4 / 5px inside the panel, so it now has 119 / 128px. The text is 9.5px (wide, -0.1px tracking) or 10px (compact), with a fixed 4px gap before the send button (20 / 22px).
- Compact: the shared card fills the screen and the buttons sit near its foot, so the phone is cropped at the top under the toolbar (top -221, inside Monty's photo, as md-logs does). The buttons and pin then sit clear above the composer, and the phone's foot meets the composer's top. The panel clips (`overflow: hidden`). The highlight is clipped to the panel, as the product's overlay is, so the card's box stops under the toolbar. The hover point over the card is taken from its visible part. The phone sits 8px left of center to leave room for the field.

Gate: `--gate` at 1280 and 390 both end `rehearsal passed`. The remaining lines are the known `fly size` candidate (now reported at 1280 too: the chip takes off at 96×24 from the 112×26 field) and "inconclusive" coverage from sampling gaps of about 30ms. Loops: `shots/md-annotate/phone-loop.png`, `phone-loop-390.png`. Stills: `phone-typed-*`, `phone-hover-*`, `phone-landed-*`, `phone-poster*.png`. Video `videos/md-annotate.mp4` (12.30 s), frames `phone-video-{1.6,4.6,8.6}.png`.

## Unify (shared md-* frame)

Moved onto `examples/md-shared/frame.ts` + `frame.css`, per `UNIFY.md`:
- Stage `STAGE` (960 × 540), `unframed` (the shared frame asks for the window whole with an even margin, which film's floating check would otherwise fail as `framing`).
- The window is `md-window`: whole at 48/40, 864 × 460, `--md-shadow-window`. The example's own window position, size and shadow, and the bottom bleed, are gone. Standard 38px kit bar with lights; the device toolbar still sits over the device column, now 300 wide from the window's right.
- The device view is `md-device-pane` (300 wide) with the kit `Phone` at `DEVICE_PANE.phone` (190), centered both ways in the 422 body.
- Re-laid for the bigger body: the chat column is now 564 wide (history inset 28, a longer bubble and answer, a changed-files card with two rows and +/- counts, the composer inset 20 from the column's sides and foot). The whole phone screen shows now, so HorseTinder's card runs down to the actions, which sit just above the home indicator (wide only; compact crops the phone at the stage foot and keeps the old, higher layout).
- The device picker reads "iPhone 17 Pro" (the iOS version no longer fits beside four tools in 300px).
- The note field: the product places it right of the element, clamped inside the panel. With a 190 phone in a 300 pane there are 131px between the carrot and the window's edge, so wide the field is sized to that room (5px from the carrot, 6px inside the window's right edge; 28 tall, 10.5px text, 22px send) and covers the LIKE button as the real overlay would. It opens beside the carrot and stays inside the window. The pin is 18px.
- Cursor: `REST.wide` is now (640, 196), the pane's blank margin left of the phone; every other move is `data-target` + `rect()`.

Unify checks: `--gate` passes at 1280 and at 390 (`fly size` is the known candidate below). Poster `shots/md-annotate/unify-poster.png`, payoff `unify-landed.png`, reduced-motion poster `unify-reduced.png`, video `videos/md-annotate.mp4` (12.28 s, 1920 × 1080), frames at 0.2 s, 5.0 s and 8.6 s in `shots/md-annotate/unify-video-*.png`. Coverage at 1280 read "inconclusive" (sampling gaps over 27 ms with other builders filming).

## Before unify

Gold: `hero-demo`. Kept: the annotate structure (overlays positioned from measured targets, a numbered marker that scales in, an inline note popup that types then submits, a pinned window that bleeds off the bottom, a reset that removes what the loop added). Changed: the white page with no plate; Mobile Dev's own look (the Codex-style window with the chat column on the left and the device view on the right, the device picker, lucide toolbar icons, the blue pointer toggle, the real field shape and its black round send button, the blue 2px highlight, the white-ringed blue pin); a kit `Phone` running HorseTinder; the payoff is a "Context · 1" chip flying into the chat composer instead of a terminal paste.

Beats: 1 pointer tool turns blue … 2 the highlight follows the cursor over the photo card, then springs to the carrot … 3 click; the note field opens beside it; "Make this an apple" types … 4 send; the field closes, pin 1 scales in, a chip buds where the note was and flies into the composer as it makes room … payoff holds about 2 s; the tool turns off, the pin fades and the composer row closes with the chip. Loop about 13 s.

Captured: wide 720 and 390 (compact 358 × 516), contact sheets at 500 ms, `--states` at both widths, the reduced-motion poster at both widths, the send/flight at 60 to 80 ms (zoomed), the landing at 60 ms, the reset and seam at 150 ms, the field at 4x. Light theme only (the brief names no other look).

Film:
- `--gate` passes on the wide loop, the 390 loop, `--states` at both widths and both posters.
- Coverage reads "inconclusive" on every loop because of sampling gaps over 27 ms. The machine was shared with other builders filming in parallel.
- `fly size` (390 only, a candidate rather than a gate line): the chip takes off at 96×24 where the note's text (103×17) was. It stands because the note turns into a different object, a context attachment, and is not the text being carried. The field fades out before the chip buds, so the two never overlap.
- Earlier lines, all fixed:
  - `settle snap` on the highlight: the dwell on the card is now longer than 1 s, and the spring is softer.
  - `lands on a transform` on the field and pin: fixed with `will-change`.
  - Flyer pops at take-off and landing: fixed with `held`, a crossfade onto the identical chip, then unmount.
  - `handoff shift`: the landing rect is now measured with `{ layout: true }`, less the row height.
  - `half-pixel glyph`: icons are 16 px in the 28 px buttons.
  - `touching` in the tags and the compact field.
  - `framing` on compact. The pane is the hero, and its shadow is tightened so the stage edge never cuts it.

Review (two fresh-eye rounds, `references/review.md`):
- Window shadow cut by the stage edge: fixed with a tighter shadow that fades inside the gutter.
- Action low and small: fixed with a bigger phone (300 wide) and a shorter photo card, so the buttons sit higher.
- Brown blur read as a broken image: fixed with a soft, out-of-focus subject and blaze.
- Onion skin at send: fixed. The field fades out before the chip buds, and the field enters with a fast fade plus scale.
- Composer opening before its cause: fixed. It now opens on the flight's clock.
- Typing too fast: fixed at 62 ms per character.
- Chip landing short, then snapping: fixed by measuring the landing rect in layout and taking off the row height.
- Bubble too heavy: made shorter.
- Composer wider than the column: now inset to the column's 18 px.
- Compact composer meeting the pane edge: now inset 12 px inside the pane.
- Carrot leaves crossing the box: the icon is 32 in a 38 box.
- Not taken: a reset by sending the message. It would grow the thread, and the thread would need its own reset.
- Not taken: the compact phone at 1:1 cropped off one side. The note field has to open to the carrot's right inside 358 px, and the product clamps it there.
- Not taken: the field's leading pointer glyph. The product shows it only when there are several candidate elements, and compact has no room for it.

Assumptions:
- The chip's flight is illustrative. In the product the chip simply appears in the host composer.
- The Mobile Dev toolbar sits in the window's title row, a simplification of Codex's separate panel header.
- The chat history is filler, per the brief.

Unresolved:
- The chat history stops about 50 px above the composer at rest (about 20 px with the chip row open). That space is where the chip row opens, so the history cannot grow into it.
- Wide, the phone's own type is small (the 190 phone draws a 16pt label at about 7px; 14px in the 2x video). The shared pane size sets this.
- Compact phone text renders at about 10.5 px, just above the floor.

Not checked:
- The playground's own `?capture=md-annotate` and viewer. The running dev server's example list predates this folder and reports "Unknown example". Everything was filmed through `examples/md-annotate/dev.html`, a stand-in that mounts the component the way `playground/preview.tsx` does.
- The dark theme.
- Touch input, live rAF pacing on a real device, and pause, resume and offscreen in the viewer.
- Toggling reduced motion during playback.
