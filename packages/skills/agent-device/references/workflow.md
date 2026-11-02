agent-device 0.20.9 — workflow

Command shapes, refs, selectors, waits, recovery, and platform limits for the default open -> snapshot -i -> settle -> verify -> close loop.

Command shape:
  Command lines only -- no prose, numbering, fences, pipes, or grep/head/tail/jq on agent-device output; raw output carries the refs/hints the next step needs. Subcommand first, then positionals, then flags: agent-device open com.example.app --session checkout --platform android --relaunch
  Chain confident consecutive steps with &&: press 'label="Search"' --settle && fill 'label="Search"' "query" --settle. Fall back to one command at a time when a step is uncertain (ambiguous match, network-backed result, unseen screen).
  Refs look like @e12; use the exact ref from the latest snapshot -i, never a placeholder (@ref, @eN, @Label_Name). Pin with ~s<n> (press @e12~s4); iOS rejects a stale pinned ref -- refresh with snapshot -i or use a selector.
  close = agent-device close. App back is back; system back is back --system. Taps are press/click. type never takes --settle: run type, then diff snapshot to verify. Known flow: batch ./steps.json (help scripting).
  Gestures: scroll/swipe for lists/flicks; gesture pan|fling|pinch|rotate|transform|drag for multi-touch. Shapes and platform quirks: help gestures.

Bootstrap:
  agent-device devices --platform ios
  agent-device open MyApp --platform ios --device "iPhone 17 Pro"
  Known app: open <app> --foreground -> snapshot. Bare form needs one running app on one iOS sim; capture failure keeps session open.
  Install arguments are app/package id then artifact path: agent-device install com.example.app ./dist/app.apk --platform android, then open <id> --relaunch for fresh state. Use reinstall only when explicitly requested.
  Unknown app id: devices, then apps, then open <discovered-app-id>. Never open artifact paths or invent package ids; ask if lookup misses the target.
  Apple CI: prepare ios-runner after boot/install, before replay/test (help prepare). Remote/cloud: connect -> open -> commands -> close -> disconnect (help remote). Reusable scripts, secret-safe fills, replay repair: help scripting.

Snapshots and refs:
  snapshot reads visible state; snapshot -i gets current interactive refs only -- the fast path before an interaction. Default text is agent-facing and token-efficient; --raw/--json only for the full provider tree.
  Legend: @e12 [button] label="Add to cart" enabled hittable -> press @e12. [off-screen below] -> scroll down (a hint, not a ref).
  Refs stay valid until you press/click/fill/type/scroll/back/wait-for-async-UI, or otherwise change app state; open/--relaunch clears the stored snapshot outright.
  Prefer --settle and continue from its settled diff when it shows the next target; refresh with snapshot -i only when you did not settle, settle reported not settled, or its output lacks what you need. A known selector/label after a mutation is often enough, since interaction commands refresh state internally.
  Truncated preview: snapshot -s @e12 (the current concrete ref), not get text. Missing target in a list: scroll down/up (not bottom/top unless the task wants the edge), then snapshot -i. TV/D-pad focus: help tv.

Selectors:
  id="field-email", label="Allow", role=button label="Search" -- not bare role keys (button="Search"); no CSS selectors/--selector/--text/raw x-y when refs/selectors exist.
  Mutating selector ambiguity: press/click/fill/longpress collapse duplicate accessibility wrappers only when every match is one ancestor-descendant chain resolving to the same actionable node. Matches in distinct subtrees fail with AMBIGUOUS_MATCH and a bounded candidate list; geometry never chooses a winner. Retry one printed candidate ref (pinned to refsGeneration) or narrow the selector with role/id/longer text. Read-only commands and replay suggestions retain their declared resolution policies.
  hittable: false on a resolved element does not block dispatch (iOS AX flags are unreliable on deep RN trees); press/fill/click return targetHittable: false plus a hint -- verify or re-target, not a failure.

Text entry:
  fill replaces; type appends to an already-focused field: fill 'id="field-email"' "qa@example.com"; type "Handle with care" --delay-ms 80
  Empty replacement is not a clear-field command (do not plan fill <target> ""); use a visible clear/reset control, or report the gap.
  Plain fill/type first; if an iOS debounced/search-as-you-type field drops characters, retry with --delay-ms before clipboard paste.
  The keyboard usually does not block interactions -- press the next target directly. keyboard dismiss taps its own dismiss key when one exists, else UNSUPPORTED_OPERATION. Android: try dismiss before back. iOS: when both fail, do not tap a static text/heading hoping it is safe; prefer type "\n" to submit.
  iOS paste-prompt limits and Android IME/handwriting capture quirks: help debugging.

Session ordering:
  Stateful commands (open/press/fill/type/scroll/back/alert/replay/batch/close) run serially within one session. Parallelize only read-only commands, or separate sessions/devices.

Read-only and waits:
Wait failure contract:
  Read the verdict from error.details.reason in --json, not the message text.
  wait_target_absent: a readable capture ran and found no match.
  wait_capture_stalled: no readable capture finished before the deadline -- retriable.
  wait_deadline_exceeded: a later capture used the remaining budget after an earlier readable one.
  wait_landmark_identity_mismatch: a replay destination guard found the selector but not the recorded identity.
  wait_stable_timeout: wait stable never saw a stable UI -- not an absence verdict.

  snapshot/get/is/find answer read-only questions; snapshot -i only when refs are needed. --settle confirms local UI quieted; for results that arrive later (network/debounce), follow with wait text "Expected result" or wait <selector> instead of polling.
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

Lifecycle facts (trust these instead of probing): open without --relaunch is idempotent-foreground; --relaunch restarts it. close keeps a healthy iOS runner warm by default; runners and daemons both self-idle after 5 minutes, and a stale lease reclaims automatically -- a live owner still rejects with "already owned by another agent-device daemon". Env vars: help physical-device.

Escalate:
  help manual-qa scripted manual QA
  help dogfood exploratory QA report
  help validate engineering self-validation
  help debugging logs, network, alerts, traces, text-entry
  help scripting recording, save-script, batch, replay repair
  help gestures multi-touch gesture shapes/quirks
  help tv Android TV, tvOS, Vega VVD remote
  help react-devtools RN perf/profiling, hooks, renders
  help react-native RN hazards, Metro/Re.Pack, routing
  help remote remote/cloud config, lease, tunnels
  help macos desktop, frontmost-app, menu bar
  help web minimal browser loop
  help ios-system-ui SpringBoard, widget, system-UI

Related:
  agent-device help <command>   command-specific flags
  agent-device help manual-qa   routine QA loop
  agent-device help workflow    full automation reference
