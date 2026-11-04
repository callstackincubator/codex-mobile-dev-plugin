# Rehearsal: md-simulators

## One HorseTinder phone (PHONE.md)

Both phones now run the shared app (`examples/md-shared/HorseTinder.tsx`) through `<HorseTinderPhone>`, in wide and compact. The iPhone is `frame="pro"` on Monty. The emulator is `frame="android"` with Juniper on top and Clover as `next`. The old wordmark, painted SVG horses, cards, tags, PASS / Mega Carrot / LIKE labels, wallpaper and every `.hts-*` rule are gone. The swipe goes through `card`: `data-target="adeck"`, the class `mds-throw` (a lasting layer) and the drag/throw transform, transition and visibility. Clover's rise goes through `nextCard`: the class `mds-rise`, scale 0.94 until `data-up`. No `.ht-*` rule is restyled. The drag scale `k` now comes from the phone width over the Pixel's 434pt frame width, since the deck is no longer a target. In compact, the crop now falls in the pink between the card and the buttons.

Gate: `rehearsal passed` at 1280 and at 390, both inconclusive (sampling gaps). New line at both widths: `half-pixel glyph` on the shared `.ht-name` check (26px icon in a 41.4px line box) while a card moves. This is md-shared geometry, so it is left alone. At 390 there is also a `near aligned` line: the compact iPhone picker label sits 13.7px from the HorseTinder logo. `dark slab` and the compact `small text` are unchanged from before, and the horse-eye `drift` is gone. Video re-exported (13.8 s). Frames at 0.5 s, 6.9 s and 9.6 s were checked.

## Unified frame (UNIFY.md)

Wide now sits on the shared md-* frame (`examples/md-shared`): a 960 × 540 stage with the kit `Window` as `md-window` (whole at 48, 40, 864 × 460, `--md-shadow-window`). The old 720 × 440 stage, the window that ran off the bottom and its own shadow and position rules are gone from the wide layout. Compact is unchanged: the same 358 × 336 design, its old window and shadow now scoped to `[data-layout='compact']`.

How the 864 px are used: the product's side-by-side workspace (`img/screenshot_side_by_side.png`). A quiet Logs column, 264 wide (the window less two 300 px panes), sits on the left. It has a Filter logs... field, two tool buttons and twelve info rows of filler in md-logs' row style. Nine one-line rows and three two-line rows fill its 378 px exactly, so no row is cut under the toolbar. The two `md-device-pane`s fill the rest. Each holds a whole phone at `DEVICE_PANE.phone` (190), centered both ways. Before Android arrives, the iPhone pane sits centered in the 600 px device area. It moves to the left half while the emulator's pane slides in from the window's right edge. The phone never changes size.

The device toolbars moved into the window bar, each over its pane, the way md-logs puts its device picker in the bar. With a 190 px phone in a 422 px body there is no room for a toolbar row inside a pane. Each pane's divider runs up through the bar. The emulator's toolbar slides in with its pane. The bar holds three tool icons per device (home, app switcher, screenshot). The pointer tool was cut so "Medium_Phone_API_36.1" fits whole in 300 px. "Mobile Dev" and the platform select (iOS / Both) share the Logs column's stretch of the bar. The select ends 10 px before the column line, so its menu opens over the logs, never over a phone.

HorseTinder is laid out for whole phones in wide (scoped CSS): the card runs down to the buttons, and the Mega Carrot button is the big one, riding over the card's foot as in the app. Its foot is level with PASS and LIKE, so the three labels share a line. Compact keeps the old geometry, so its crop still falls in the pink above the buttons.

Cursor: `REST` is derived from `WINDOW` (the empty band between the Logs column and the lone iPhone). The cursor no longer "clears the way" during the split in wide, because the menu is over the logs and it is already clear. After the throw it moves into the gap between the phones (`stage-ios` at x 0.93). Everything else aims at `data-target`s as before. The Stage is `unframed` like the other md-* previews: UNIFY.md asks for the window whole in an even gutter, which the floating-window check would otherwise fail.

Gate (wide 1280 and 390): `rehearsal passed` on both loops and on `--states` wide. Every run is "inconclusive" because of sampling gaps of 28 to 55 ms on a machine shared with parallel builders. Lines left standing: `dark slab` (the kit phone glass), `drift` (the horse's eyes on the rotating card), and at 390 `small text` on the kit status bars and the swiped card `clipped` by its screen. All four are explained below and unchanged from before. Video: `videos/md-simulators.mp4`, 1920 × 1080, 60 fps, 13.8 s. Frames at 0.1 s (lone iPhone), 6.9 s (the throw) and 9.6 s (payoff: Monty and Clover) were checked.

Not checked in the unify pass: a fresh-eye review and the 4x zooms.

## Before the unify pass

Gold: `window-row`. I kept one window at a time with focus by depth, the 24px gutter and only filler cropped. The layout and swipe come from `device-pair` and `swipe`. What changed: there is one Mobile Dev window, inset at the top, left and right on a transparent white page and running off the bottom. Its two device panes sit side by side, and each phone is cut in the pink between the card and the PASS / LIKE buttons. The throw-at-release-speed swipe is borrowed from `swipe`, done with a desktop arrow (the panel is driven by mouse) using `cursor: 'preserve'`.

Beats (loop about 12.7s):
1. One iPhone 17 Pro pane streams HorseTinder (Monty, 9). The platform select reads "iOS".
2. The cursor opens the platform menu and ticks Android. The label rolls to "Both" and the menu closes.
3. The Android pane slides in from the window's right edge (Medium_Phone_API_36.1, Juniper, 5) while the iPhone pane narrows. This is the poster.
4. The cursor swipes Juniper off the emulator and the next card (Clover, 7) comes up. The payoff holds for about 2.3s.
5. Reset with a visible cause: the menu unticks Android and the pane slides out. The emulator's deck snaps back while its pane is hidden (`visibility: hidden` after the slide).

Captured: wide (1280 viewport) and 390 viewport loops, `--states`, reduced-motion posters at both widths, a 4x zoom of the swipe, the menu and split beat at 80ms, and an outside fresh-eye review (frames `review-*.png`). Light look only.

Film:
- `--gate` passes on the wide loop, at 390 and with `--states`. Every run says "inconclusive" because of sampling gaps of 28 to 36ms. The machine was busy with other builders filming in parallel.
- `dark slab: ss-phone__glass`: the kit phone bezel. This is a platform convention and stays.
- `small text: ss-phone__time` at 390 (5.8px and 4.8px): the kit status bar at true proportion on two 140px phones. I first hid it in compact. The reviewer asked for it back as product look, and craft.md says never shrink system chrome, so it stays.
- `clipped:` at the throw mark: Juniper's card leaving through the phone screen's edge. This is intended (motion.md: a swiped item is cut only by its list's edge).
- `drift: ellipse and ellipse`: the horse's eyes on the rotating card during the swipe. The tilt is intended.
- Fixed along the way:
  - The swipe moved in stage px inside a scaled screen, so the card never left. It is now converted by the deck's measured scale.
  - A hidden-pane reset was detected as jumps. The pane is now made invisible before the snap.
  - The menu rows were lopsided and had uneven padding. They are now `role="option"` rows with an absolute check slot, as the product's base-select draws them.
  - The cursor covered its labels. Its aim points moved.
  - Text steps from layout motion are fixed with lasting layers.
  - "Horse" was touching "Tinder". It is now one wordmark.

Review:
1. The hero shadow was cut square at the stage edges, which read as a plate. I tightened the window shadow so it fades inside the 24px gutter.
2. The single-phone state held too long. The opening wait went from 1000 to 450ms and the tail was shortened.
3. After the swipe both panes showed Monty, which looked like mirroring (not a real feature). The next card is now Clover, 7, "Freeride kind of girl", from the real HorseTinder app data in `~/Documents/GitHub/horse-tinder/App.tsx`.
4. The menu was fading over the panes as they moved. It now closes 260ms before the split or close starts. `pick` (tick and label) is split from `android` (pane).
5. The compact status bars were empty. Restored.
- Minor: the flash orb read as a stray light. Made smaller and softer.

Assumptions:
- No chat column. At 720 wide a chat beside two panes truncated both device names to "iPhone 17…". The real side-by-side screenshot is the panel as its own tab, and the page copy carries "beside your chat".
- The workspace's platform select is placed in the window's title bar to save a 48px row.
- Wide shows the Android name as "Medium_Phone_API_36.1" (the real label continues "· Android …" and truncates). Compact shows "iPhone 17 Pro" and "Medium_Phone…".
- The real multi-select stays open after a pick. Here it closes, to keep the panes clear.
- The swipe is on the emulator, not the iPhone, so the reset can happen out of sight.
- The HorseTinder wordmark uses Horse in orange and Tinder in pink, from the app's styles, in a rounded system face instead of Chewy.
- The photos are painted SVG horse heads, not photographs.

Unresolved: the small-text line at 390 (above).

Not checked:
- Dark theme (the brief is light only).
- True 40ms beat sequences: the loaded machine sampled at 100 to 240ms in the reviewer's runs.
- Touch input on a device.
- Live rAF pacing on a real page.
- The playground viewer's pause and replay controls.
