agent-device 0.21.33 — workflow

Command shapes, refs, selectors, waits, recovery, and platform limits for open -> snapshot -i -> settle -> verify -> close loop.

Command shape:
  Command lines only -- no prose, numbering, fences, pipes, or grep/head/tail/jq; raw output carries refs/hints for the next step. Order: subcommand, positionals, flags: agent-device open com.example.app --session checkout --platform android --relaunch
  Chain confident consecutive steps with &&: press 'label="Search"' --settle && fill 'label="Search"' "query" --settle. Fall back to one command at a time when a step is uncertain (ambiguous match, network-backed result, unseen screen).
  Refs look like @e12; use the exact ref from the latest snapshot -i, never a placeholder (@ref, @eN, @Label_Name). Pin with ~s<n> (press @e12~s4); every platform rejects a stale pinned ref -- refresh with snapshot -i or use a selector.
  close = agent-device close. App back is back; system back is back --system. Single taps are press/click; gesture tap touches 2 to 5 points at once. type never takes --settle: run type, then diff snapshot to verify. Known flow: batch --steps-file ./steps.json (help batch).
  Gestures: scroll/swipe for lists/flicks; gesture pan|fling|pinch|rotate|transform|tap|drag for multi-touch. Shapes and platform quirks: help gestures.

Bootstrap:
  open --foreground -> snapshot. Selection: explicit --device/--udid/--serial, then session, booted/bootable local, or provider; --platform/--target only filter. Ambiguous/empty fails with bounded retry selectors; no provider fallback.
  Install arguments are app/package id then artifact path: agent-device install com.example.app ./dist/app.apk --platform android, then open <id> --relaunch for fresh state. Use reinstall only when explicitly requested.
  Unknown app id: devices, then apps, then open <discovered-app-id>. Never open artifact paths or invent package ids; ask if lookup misses the target.
  Apple CI: prepare ios-runner after boot/install, before replay/test (help prepare). Remote/cloud: connect -> open -> commands -> close -> disconnect (help remote). Reusable scripts, secret-safe fills, replay repair: help scripting.

Snapshots and refs:
  snapshot reads visible state; snapshot -i gets current interactive refs only -- fast path before interaction. Default text is token-efficient; --raw/--json for full provider tree.
  Legend: @e12 [button] label="Add to cart" enabled hittable -> press @e12. [off-screen below] -> scroll down --until (a hint, not a ref).
  Refs stay valid until you press/click/fill/type/scroll/back/wait-for-async-UI, or otherwise change app state; open/--relaunch clears the stored snapshot outright.
  Prefer --settle and its diff when it shows next target; refresh with snapshot -i only when you did not settle, it reported not settled, or output lacks what you need. A known selector/label after a mutation is often enough, since interaction commands refresh state internally.
  Truncated preview: snapshot -s @e12 (the current concrete ref), not get text. Missing target: scroll <dir> --until <selector>. TV/D-pad focus: help tv.

Selectors:
  id="field-email", label="Allow", role=button label="Search" -- not bare role keys (button="Search"); no CSS selectors/--selector/--text/raw x-y when refs/selectors exist.
  Mutating selector ambiguity: press/click/fill/longpress collapse duplicate accessibility wrappers only when every match is one ancestor-descendant chain resolving to the same actionable node. Matches in distinct subtrees fail with AMBIGUOUS_MATCH and a bounded candidate list; geometry never chooses a winner. Retry one printed candidate ref (pinned to refsGeneration) or narrow the selector with role/id/longer text. Uniqueness-based reads (is except exists/absent, get attrs) share that failure shape.
  hittable: false on a resolved element does not block dispatch (iOS AX flags are unreliable on deep RN trees); press/fill/click return targetHittable: false plus a hint -- verify or re-target, not a failure.

Text entry:
  fill replaces; type appends to an already-focused field: fill 'id="field-email"' "qa@example.com"; type "Handle with care" --delay-ms 80
  fill <target> "" clears the field (replace with nothing); the empty argument must be present -- fill <target> alone is a missing argument.
  Plain fill/type first; if an iOS debounced/search-as-you-type field drops characters, retry with --delay-ms before clipboard paste.
  Element presses behind the keyboard are refused with tap_keyboard_occludes_target. keyboard dismiss taps its own dismiss key when one exists, else UNSUPPORTED_OPERATION. Android: try dismiss before back. iOS: when both fail, do not tap a static text/heading hoping it is safe; prefer type "\n" to submit.
  iOS paste-prompt limits and Android IME/handwriting capture quirks: help debugging.

Session ordering:
  Stateful commands (open/press/fill/type/scroll/back/alert/replay/batch/close) run serially within one session. Parallelize only read-only commands, or separate sessions/devices.

Read-only and waits:
Wait failure contract:
  Read --json error.details.reason.
  wait_target_absent: readable capture, no match.
  wait_target_present: absence timeout; details.matches/firstMatch.
  predicate_failed: no valid absence capture; observation/diagnostic kept.
  wait_capture_stalled: no readable capture by deadline -- retriable.
  wait_deadline_exceeded: later capture exhausted budget after a readable one.
  wait_readiness_exhausted: readiness deadline; details.readinessPhase -- retriable.
  wait_runner_restart_exhausted: restart deadline -- retriable.
  wait_landmark_identity_mismatch: replay guard: selector matched, recorded identity differed.
  wait_stable_timeout: no stable UI -- not absence.

  snapshot/get/is/find answer read-only questions; snapshot -i is for refs. --settle confirms local UI quieted; delayed results use wait text "Expected result" or wait <selector> instead of polling; strict disappearance uses wait absent <selector>.
  wait stable [quietMs] [timeoutMs] (defaults 500/10000) is the fallback for open/relaunch/navigation, or an intentionally-unsettled mutation -- not after a --settle whose diff already shows the change. Ambiguous find: add --first or --last.

Navigation:
  Pick a coordinate gesture point near the target's center, away from edges/tab bars/nav bars/the home indicator (they trigger system navigation instead); macOS context menus are secondary clicks (help macos). Action sheets/menus/camera screens are normal UI: snapshot -i, press by label/ref, handle permission sheets via UI/alert. If back is ambiguous, prefer a nav/back ref, tab-bar ref, or deep link over repeating it.

Validation and evidence:
  Nearby mutation diff: diff snapshot -i; with no prior snapshot it initializes the baseline (zero changes) instead of failing.
  Named expectations need the exact text/selector via wait/is/get/find -- a bare screenshot/snapshot is not verification. Before declaring a task done, confirm the requested end state is actually visible on the current screen, scrolling it into view if needed; get text alone, or stopping one screen early, is not enough.
  When an action only reveals or reaches a target, verify the exact target named, not just the action. Prefer testIDs/ids/selectors over visible text. Icon/tappable proof: screenshot --overlay-refs; if snapshot is sparse/AX-unavailable, use plain screenshot and coordinates, then retry snapshot -i on another screen.
  iOS merged: child ref => press it; else press parent @ref --settle. Names are not selectors.
  Perf/memory/log/network/trace/crash: help debugging. Recording, save-script, batch, replay repair: help scripting.

React Native: help react-native for Metro/Re.Pack reload, DevTools, RN overlays. JS-only change: metro reload, find "Home"; open --relaunch for native reset.

Lifecycle facts (trust these instead of probing): open without --relaunch is idempotent-foreground except native macOS app opens (background); --relaunch restarts it. close keeps a healthy iOS runner warm by default; runners/daemons self-idle after 5 minutes; stale leases self-reclaim. open device claims reclaim other worktrees' warm runners; "already owned by another agent-device daemon" = owner outside claim arbitration. Env vars: help physical-device.

Escalate:
  help manual-qa scripted manual QA
  help dogfood exploratory QA report
  help validate engineering self-validation
  help debugging logs, network, alerts, traces, text-entry
  help scripting recording, save-script, batch, replay repair
  help gestures multi-touch gesture shapes/quirks
  help tv Android TV, tvOS, Vega VVD remote
  help react-devtools RN components, props/state/hooks, render profiling
  help react-native RN hazards, Metro/Re.Pack, routing
  help remote remote/cloud config, lease, tunnels
  help macos desktop, frontmost-app, menu bar
  help web minimal browser loop
  help ios-system-ui SpringBoard, widget, system-UI

Related:
  agent-device help <command>   command-specific flags
  agent-device help manual-qa   routine QA loop
