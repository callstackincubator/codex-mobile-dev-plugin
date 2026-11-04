# Rehearsal: md-storage

## Unify pass (UNIFY.md, shared md-* frame)

What changed:
- Stage 960 × 540 from `STAGE`. The main Window has `md-window`, so `md-shared/frame.css` places it at 48, 40, 864 × 460 with `--md-shadow-window`. The wide `.mst-frame` wrapper, its inline geometry and the hero shadow are gone (compact keeps its own wrapper and shadow). `unframed` on the Stage, as md-annotate, md-recording, md-simulators and md-performance-live do: the spec's whole window in an even gutter would otherwise trip film's floating-window `framing:` line.
- Standard 38px kit bar, unchanged content (title, Storage select, device select).
- The simulator is a `md-device-pane` (300 wide, left border) with the Phone at `DEVICE_PANE.phone` (190), centered both ways. It replaces the old 174px pane with the 158px phone.
- Re-laid for the 564 × 422 Storage body. Browse has the header, 5 real keys and 6 filler rows, and runs to the window's foot. Changes has the like row, 4 history rows and filler over the product's own footer ("N changes since 17:40:12", SDK changes switch, Clear, from `storage-changes.tsx`). The list's foot fades over 28px (`data-crop`, a scrolling list). The key column is 160px.
- Cursor: `REST` is a target (`views` at 0.78/0.56, compact 0.74/0.62). Every click and move aims at a `data-target`. No stage coordinates remain.
- Loop reset (storage only). The pass now ends where it began, so the conveyor is gone. After the payoff holds 2s: Reset, then the product's confirm popover (its copy from `storage-view.tsx`/`ConfirmButton`), then Reset app data. HorseTinder closes into its home-screen icon, and the product's status strip "Cleared all app data. The app was stopped." appears with Launch app. The deck snaps to Monty while the app is closed. Launch app opens the app out of its icon on Monty. This run's `likes` row collapses out of Changes and the count rolls 5 to 4. The cursor clicks Browse (`[2 items]`, changed while that tab was hidden) and moves to rest. Pass ≈ 15.5s. The film no longer reports `loop seam`.
- Compact: Reset is an icon button beside Refresh, so the reset has its trigger. The app picker truncates to fill the row. The confirm opens upward over the phone because there is no room below the toolbar. The status strip says "Cleared all app data." only.

Gate:
- `--gate --width 1280`: `rehearsal passed`. What remains: `drift: ellipse and ellipse` (the horse's eyes during the fling and the app's close/launch scale), and `incomplete: sampling gaps` (machine load).
- `--gate --width 390`: `rehearsal passed`. Same drift and sampling lines, plus `touching: span.mst-select__label "HorseTinder"`: the truncated picker label's measured text runs under its ellipsis and chevron. It reads clean in the still (`shots/md-storage/unify-stopped-390.png`).
- `npx tsc --noEmit -p playground`: nothing in md-storage.
- Poster `shots/md-storage/unify-poster.png`, payoff `unify-payoff.png`, reset sheets `unify-reset.png` / `unify-reset-390.png`, loops `unify-loop.png` / `unify-loop-390.png`. Video `videos/md-storage.mp4` (1920 × 1080, 60fps, 15.48s). Start, payoff, confirm, home screen and end frames were checked with ffmpeg. The first and last frames match.

Fiction in the reset (spec asks for a seen cause; the product cannot return to the opening on its own):
- The real Reset app data deletes the container, and the next read logs every key as removed. Here the relaunched app's store reads back as it began (`likes` [2 items], the other keys intact), and this run's change leaves the list with the count back to 4. The real Changes list only grows until Clear.
- The real status strip says "Launched the app." after Launch app. Here it closes, so the opening frame returns.
- The home screen is quiet filler tiles with HorseTinder's real icon in one slot.

---

Earlier pass (720 × 440, before the shared frame). Kept for history. Geometry, the conveyor loop and the 158px phone below are superseded by the section above.

Gold: `device-pair` for the layout family (one window, a phone with the story's cause, white page, window off the bottom). I kept its gutter discipline, hero shadow and "phone present from frame one". I changed the arrangement: the phone sits inside the window as Mobile Dev's own simulator pane, the way the real split workspace draws it (tool left, simulators right; `packages/mcp-app/src/components/workspace.tsx`). Storage's toolbar (app picker, Browse/Changes, filter, Refresh, Reset) needs about 500px. A 220px+ satellite phone would have covered either the app picker or Refresh, and Refresh is part of the story. Motion is borrowed from `table-edit` (the value changes in place with one wash) and `md-simulators` (HorseTinder screen art, kept consistent across the set).

Beats (about 11s a pass):
1. The cursor clicks LIKE on the simulator. Monty is thrown off to the right (the app's 300ms ease-out, 18deg) and Juniper comes up from 0.96.
2. Refresh. Browse reads on request, as the product does (`storage-panel.ts`: "Only the visible Changes tab re-reads storage; Browse refreshes on request"). The icon turns once, and Refresh and Reset rest at 50% while the read runs.
3. `likes` rolls `[2 items]` to `[3 items]` under one green wash, and the Changes count rolls 4 to 5.
4. Changes opens with a sequenced page swap. The new row is on top, with `[21,34]` struck through next to `[21,34,7]` and the four earlier changes below it. The filter placeholder switches to "Filter changes…". Payoff, held.

The loop is a conveyor. The next pass clicks Browse and likes the next horse in HorseTinder's real deck order (Monty, Juniper, Clover), so storage only grows in view and nothing is put back. Offscreen, the Stage resets to the opening.

Captured:
- Widths: 720 wide (`--width 1280`) and 390 (the compact design at 358).
- Light look only.
- `--states` at both widths, 30-frame loops at both widths, and the reduced-motion poster at both widths.
- 40/60ms close-ups of the page swap (`swap.png`, `changes-zoom.png`) and the toolbar (`toolbar-zoom.png`).

Film (`--gate`): `rehearsal passed` on the wide loop, the 390 loop, and `--states` at both widths. These lines remain:
- `drift: ellipse and ellipse` at the like beat. These are the horse's eyes inside the card while it rotates as it is thrown. It is the rotation, and it stands.
- `loop seam: state still differs from initial (tab, k, m)`. This is the conveyor, by design (see above).
- `incomplete: sampling gaps`. Machine load during capture, not a scene finding.
- An earlier `handoff shift: span.ss-bar` (filler bars in the two views lining up during the crossfade) went away once the swap was sequenced.
- `class-clash` against md-simulators and md-logs: clean.

Review (fresh eye), and my response:
1. The phone is small and whole and the window is whole on three sides. It stands: this is the product's real split workspace. The phone is as large as fits with the LIKE label clear of the bottom edge and no sliver crossing (158px). Bleeding the window off the right would cut the simulator pane.
2. Compact payoff truncated. Fixed: the store chip is dropped in compact rows, and the old value gives way before the new one.
3. The compact phone takes 60% of the tile. It stands: the phone must out-area the window to lead the frame, and the window still shows the toolbar and three rows.
4. Changes was 3 real rows over 5 bars. Fixed: four earlier real changes (megaCarrots, onboarding.done, search.radiusKm, profile city as a field diff) over 4 bars.
5. The `{}` chip on non-JSON keys in Changes is correct. The product's Changes rows show the store's kind chip (AsyncStorage, violet), not the value type.
6. The likes highlight was weak. Fixed: the wash is stronger and held longer (1.3s). Clear stays red outline because the product draws it that way.
7. The loop never resets. It is the conveyor, kept deliberately. The phone clock now follows the change times.
8. Onion-skin crossfade. Fixed: the old view leaves in 100ms and the new one enters 80ms later.
10. "Filter chan…" stands. It is the real flex field, narrowed by the tab count.
11. Row pitch stands. It is the product's: Browse py-1.5, Changes py-2.
12. The wordmark stays as in md-simulators, for consistency across the set.

Assumptions:
- HorseTinder's real `recordLike` keeps likes in memory. The `likes` AsyncStorage key, its ids and the other keys are illustrative, written in the shape the storage test app uses.
- The app picker's icon is HorseTinder's real `assets/icon.png`, the Expo default. It is copied here as `app-icon.png`.
- The arrow cursor clicks the phone because it is Mobile Dev's mirrored simulator, clicked with the mouse. It is not a physical phone.

Unresolved:
- A recorded video of one pass will not loop seamlessly, because the conveyor's values differ at the seam. A README GIF would need a cut or a different seam.

Not checked:
- Dark theme.
- Real-device touch.
- Playback, pause and Replay in the viewer page (only the `?capture` route was filmed).
- rAF pacing on a real page.
- Host page integration.
