# Testing panel — record e2e tests from the mirror

Status: steps 1-4 of the build order are implemented — the tab, the project picker, launching the
app, tap recording with selector resolution and a live preview, and saving the test into the
project. Swipes, typing and the Run button are still design only.

A new workspace tool, **Testing**, that turns the existing simulator mirror into a
Maestro-Studio-style recorder: pick a project, launch its app, tap the mirror, and watch the test
source grow one step per interaction. The file is written to the project when the user clicks Save.

First pass targets the **iOS simulator** and the **e2e** runner (`@e2e-dev/mobile`).
Maestro YAML is a second emitter behind the same recorder.

## Scope of the first pass

| Decision | Choice |
|---|---|
| Platform | iOS simulator only (Baguette stream path) |
| Tap → code | Resolve a selector from the accessibility tree; fall back to coordinates |
| Output | Live **preview** in the panel; written to the project's `tests/<name>.e2e.ts` only on **Save** |
| Emitter | e2e TypeScript now; Maestro YAML later, same recorder |

Android (`serve-emu`) and physical iOS (`ios-mirror`) are explicitly out of the first pass.
Both already have input and hierarchy paths, so they slot in behind the same interfaces.

## What already exists

Almost every primitive is in place; the panel is mostly wiring.

| Need | Existing piece |
|---|---|
| Mirror frames | `packages/core/src/stream-sessions.ts:78` → MCP `resources/read`, drawn on canvas in `packages/ui/src/simulator-panel.ts` |
| Pointer capture over the mirror | canvas `pointerdown/move/up` at `packages/ui/src/simulator-panel.ts:855-892` |
| Touch injection | `mobile_stream_input` (`packages/core/src/panel-tools.ts:343-390`) → `stream-input.ts` batching |
| Accessibility tree | `baguette.describeUi(udid)` (`packages/core/src/baguette.ts:118`), exposed as `mobile_describe_ui` (`panel-tools.ts:292`) |
| Hit-testing a point | `componentAt` / `componentsAt` (`packages/shared/src/screen-annotations.ts:89,120`), already driving hover/select in the mirror |
| Tab registration | `toolNames` in `packages/ui/src/workspace-tools.ts:11`, label/icon map in `packages/mcp-app/src/components/workspace.tsx:27` |
| Maestro replay (later) | agent-device script-replay runs compatible Maestro YAML (`packages/runtimes/agent-device/tools.json`) |

Two things do **not** exist:

1. **No path writes into the user's project.** Every `writeFile` in the server targets its own
   state (recordings, tracesift, clipboard temp files). The server does not know a project root.
2. **No codegen of any kind.**

## Architecture

```mermaid
flowchart LR
  Canvas[Mirror canvas] -->|pointerdown / contextmenu| Rec[TestingPanel recorder]
  Rec -->|mobile_testing_read_tree| Tree[agent-device snapshot, projected by @e2e-dev/mobile]
  Tree --> Hit[hit ladder]
  Hit --> Step[RecordedStep]
  Rec -->|mobile_stream_input| Device[Simulator]
  Step --> Emit[emitE2eTestLines]
  Emit -->|mobile_testing_write_file| File[project tests/*.e2e.ts]
  Emit --> Spans[per-step line spans]
  File -->|mobile_testing_run_test| Run[e2e run --reporter json]
  Run --> Spans
  Spans --> View[Preview, marked per line]
```

### Where the mirror sits

In the Testing panel the mirror is on the **left** and the step list and preview on the right;
every other tool keeps the simulator on the right. Recording is done by tapping the mirror and read
back in the preview beside it, so the mirror leads in the same direction the panel is read. It is
one flag in `packages/mcp-app/src/components/workspace.tsx` that reverses the resizable group's
children, and only when the workspace is side by side — stacked, "left" is the top panel, which the
simulator already is. The hover outline is unaffected: `TestRecorderOverlay` positions it from the
annotation store's viewport, which is measured **inside the stage**, so moving the stage within the
workspace does not move the rectangle, and the stage's own `ResizeObserver` re-measures when the
swap changes its width.

### 1. The tab

- Add `"testing"` to `toolNames` (`packages/ui/src/workspace-tools.ts`).
- `TestingPanel` controller in `packages/ui/src/testing-panel.ts`, same `subscribe`/`getSnapshot`
  store pattern as `LogsPanel`.
- `packages/ui/src/components/testing-view.tsx` renders the step list, the project picker, the
  record/stop control and the generated source.
- Entry in the label/icon map in `workspace.tsx`.

The view sits where the other tool views sit — beside the mirror, which `DeviceWorkspace`
already renders. No new mirror.

### 2. Project selection and launch

The panel has no notion of a project today. Add:

- **The user always picks the project explicitly** — the panel never infers it from the server's
  cwd. A folder picker; the choice is persisted so it is one click on the next session. Validate it by
  reading `e2e.config.ts` (or `package.json` depending on `e2e`). Persist the last choice in
  panel state.
- Read the chosen `e2e.config.ts` to learn the **target** and the **bundle id**, so the recorder
  launches the same app the generated test will (`app: { bundleId: … }`). Parsing TypeScript config
  is the awkward part — prefer shelling out to the project's own `npx e2e config --json` if the CLI
  exposes it; otherwise fall back to asking the user for the bundle id once and caching it.
- Launch via the existing device/app tooling (`DeviceAppsStore`), not a new path.

### 3. Recording a tap

The ordering matters, and it is the one genuinely tricky part:

1. `pointerdown` on the canvas. **Before** forwarding input, the recorder needs the hierarchy of
   the screen as it is *now* — after the tap it may be gone.
2. Keep a **cached tree**, refreshed on screen-settle (the mirror already knows when frames stop
   changing) and invalidated on every injected input. On `pointerdown`, hit-test against the cache;
   if the cache is stale, issue `mobile_describe_ui` and hold the input for one round trip (tens of
   ms on loopback — acceptable; a dropped tap is not).
3. Forward the touch to the device exactly as today, so the app behaves normally while recording.
4. `componentAt(point)` gives a `ScreenComponent { role, identifier, label, value, bounds, react }`.

While recording, `pointermove` runs the same resolution against the same cached tree and draws an
outline over the mirror with the step it would record (`packages/ui/src/components/test-recorder-overlay.tsx`).
It is a preview, not a second code path: what is outlined is what a tap records. The outline is
cleared whenever the cache is invalidated, because the screen it described is gone.

### 4. Selector resolution

Priority, first match wins:

| Rank | Source | Emitted |
|---|---|---|
| 1 | `testId` | `screen.getByTestId("Submit")` |
| 2 | `role` + accessible name | `screen.getByRole("tab", "Explore")` |
| 3 | `placeholder` | `screen.getByPlaceholder("Search transactions")` |
| 4 | name or text | `screen.getByText("Explore Cities")` |
| 5 | accessible name | `screen.getByLabel("Forward, File-based routing")` |
| 6 | nothing resolves | `screen.tapAt(x, y)`, preceded by a wait, + a `// TODO: add a testID` comment |

These are the runner's own query kinds, counted the way `locate.js` counts them, over the runner's
own tree — see "Reading the runner's tree" below. In particular:

- **A role query needs a name.** `getByRole(role)` alone matches every element of that role, so a
  role with no accessible name is not a candidate at all. A search field whose only text is its
  placeholder has no name, which is why rank 3 exists: iOS accessibility offered the placeholder
  *as* the name, the recorder emitted `getByRole("textbox", "Search transactions")`, and it
  matched nothing.
- **The role is never translated.** It is whatever the engine's projection said, passed through.
  The one thing the recorder knows about roles of its own is which ones `getByRole` *accepts* —
  `e2e`'s `Role` union is closed, and the engine deliberately keeps an element type it has no role
  for as the type itself (`other`, `application`). Those fall through to ranks 4 and 5 rather than
  reaching the file as `getByRole("other", …)`, which would not compile.
- **`getByText` and `getByLabel` answer with the innermost match only.** A device tree echoes text
  upwards — iOS reports a React Native `Text` host view and the `StaticText` inside it with the
  same label — so counting both would flag as ambiguous nearly every piece of text on screen,
  while the runner resolves it uniquely.
- **A role query skips a hidden node**, as the runner does, so an off-screen twin is not a second
  match.
- Text is compared with whitespace collapsed, because the runner normalizes and an accessibility
  label carries the rendered line breaks.

`screen.tapAt` is the only step with nothing to wait on: every locator action waits up to the
action timeout for its element, but a coordinate is always "ready", so a recorded coordinate tap
fires into the splash screen and misses. A point step therefore carries an **anchor** — the
nearest element on the same screen that resolves uniquely — and the emitter puts
`await expect(<anchor>).toBeVisible()` in front of the tap as the gate the tap cannot express.

An **assertion** that resolves to a point is refused outright rather than recorded: there is
nothing for `toBeVisible` to name, so the step would emit only comments.

The ranks are tried over the **hit ladder** — every element the point sits inside, ordered by area,
innermost first — not over one element. The innermost element often carries nothing addressable
while something just outside it holds the name or the testID, and the wheel walks the outline out
and back in when the element under the pointer is not the one the test should name.

An icon-only control with no name of its own takes the **one** piece of text inside it; two and it
stays unnamed and the ladder moves outwards, rather than guessing.

**The simulator's chrome is not in the tree.** The clock, the Dynamic Island and the battery used
to arrive in the same tree as the app's own elements, and were chosen as steps and as waits — a
recorded flow once opened with
`await expect(screen.getByLabel("Dynamic Island, Empty")).toBeVisible()`. The runner's snapshot is
rooted at the application, so there is nothing to filter: `treeHealth` is down to `ok` and
`no-accessibility`, and the recorder refuses a step only when the tree is empty.

**Depth beats rank**: the innermost element that can be named at all wins, and the ranks above
only order the candidates *within* one element. An enclosing element is reached by pointing at it
or by walking out, never by quietly outranking what is under the pointer.

**Walking out.** The outline is at a level on the ladder, and the wheel over the mirror moves it:
out to the enclosing element, back in again, re-resolved from the cached tree at no cost. The label
reads `3/7`. Pointing at a different element starts again from the innermost. The recorded step is
whatever the outline shows, so what you see is what is written.

**Roles are passed through, never translated.** The engine's projection already mapped the
platform's element type onto the runner's role vocabulary, and it is the only thing that gets a
say: a second mapping here is what put `getByRole("link", …)` and `getByRole("rcttext", …)` into
saved files. The recorder's only knowledge of roles is which ones `getByRole` accepts; see
"Selector resolution" above.

Uniqueness check: run the candidate selector back over the same tree. If it matches more than one
node, fall to the next rank, and if all ranks are ambiguous, emit the best one with an index and
flag the step in the UI. The step list should show the chosen selector and let the user override it
from the other candidates — that override is what makes recorded tests maintainable.

iOS bounds are device points, matching the mirror's own coordinate space after the canvas scale
factor is applied; no normalization needed on this path. (Android bounds are screen pixels —
handle at the adapter, not in the emitter.)

### 5. Gestures beyond tap

Typing, long press and scroll-to are recorded, but **not by watching the gesture** — by asking for
them on the element, through the menu in the next section. A recorder that infers a `fill` from a
run of keystrokes has to guess where the run ends and which field had focus; a row that says
`screen.getByPlaceholder("Search transactions").fill("Paris")` guesses nothing. Secrets never reach
the file either, because the user types the value into the menu, not into the app.

Still missing:

- **Swipe**: a drag on the mirror records nothing. `pointerdown`→`move`→`up` over a threshold would
  become `screen.swipe({ direction })`, or `locator.swipe(...)` when the start point resolves.
- **Typed-as-you-go**: key messages flow through `stream-input` and are not recorded at all, so a
  flow where the user types into the app has to add the `fill` from the menu afterwards.

### 6. The element menu: assertions and everything else

A recorder that only taps produces worthless tests. The panel used to carry a global **Assert**
toggle, which armed the next tap to assert instead of acting. That is gone, and so are its tests:
one mode flag could express one extra step, and the moment typing, long-pressing and scrolling were
worth recording it would have needed one flag each.

**A left click only drives the app.** It records nothing, recording or not. Tapping to find the
next screen used to add a step for every tap on the way, which the user then deleted, and it made
"drive the app" and "record a step" the same gesture. Steps come from the menu alone.

**A row records the step and takes it.** A step recorded but never taken leaves the app on the
screen before it, so the next row would be resolved against a screen the test will not reach. `tap`
taps the element's own centre — where the runner's locator action lands, not the pixel that was
right-clicked — and `fill` taps the field and types. One gap: the runner's `fill` *replaces* a
field's contents and the mirror can only append, with no input message that clears a field, so a
`fill` into a field that already has text leaves the screen showing something the test will not
produce. The step is right; the screen behind it is not. `toBeVisible` and `scrollUntilVisible` do
nothing, because they change nothing: an assertion reads, and `scrollUntilVisible` is only offered
for an element the user just pointed at, which is on screen already.

In its place is Maestro Studio's model. **Right-click an element on the mirror and the panel offers
what the runner can do with it**, each row showing the code the step would add:

```
screen.getByText("Go To Explore List").tap()
expect(screen.getByText("Go To Explore List")).toBeVisible()
screen.scrollUntilVisible(screen.getByText("Go To Explore List"))
```

**One row per kind of thing to do, not one per variant.** An earlier pass listed `longPress` beside
`tap` and `toHaveText` beside `toBeVisible`, which made the menu five near-duplicates of one
selector — harder to read than the three choices it was actually offering. `longPress` and
`assertText` are still emitted and read back correctly; they are reachable by editing the file the
panel wrote, not from the menu.

Each row is the code in its own inset card with the chevron outside it, because a selector is long
and a line of truncated text is the one thing a menu of code must not be. The code wraps.

The rows are TypeScript because the file is; a row and the line it adds are the same text, produced
by the same `stepExpression`. Choosing a row records the step and sends **nothing** to the device,
which is what an assertion needs — acting on the element would change the thing just asserted.

What is offered comes from the element's role and what it carries, never from the app:

| Row | Offered when |
| --- | --- |
| `.tap()` | any element a selector names |
| `.fill("…")` | the role is `textbox`, `searchbox`, `combobox` or `spinbutton`, or the element has a placeholder — which only a text field does |
| `expect(…).toBeVisible()` | any element a selector names |
| `screen.scrollUntilVisible(…)` | any element a selector names |

The `fill` row needs a value, so it asks for one in the menu rather than emitting an empty string
literal; the field starts from the element's current value.

Only actions the runner can really perform on a device are offered. `secondaryTap`,
`selectOption`, `setInputFiles`, `scrollIntoView` and tap `modifiers` all exist in the runner's
typings and all fail on a device with `UNSUPPORTED_CAPABILITY`, so they are not rows.
`check()`/`uncheck()` are left out for now: the runner declares them and the mobile reference does
not say they work on a device, and a row that emits an unrunnable step is worse than a missing row
— the tap is there instead.

One thing the menu needed fixing for: the recorder re-attaches its reader whenever the simulator
panel refreshes its device list, which is every few seconds, and `attach` used to invalidate the
cached tree every time. Through `clearHover` that took the outline — and any open menu — away about
a second after it appeared, which is exactly long enough to look like a flicker rather than a bug.
Only a reader that has actually changed invalidates now.

The menu is anchored to the **element**, not to the pointer, so the wheel-driven parent walk still
applies: walk the outline out to the enclosing element and the menu re-asks what can be done with
the element it walked to, rectangle and rows together.

It carries that rectangle itself rather than borrowing the hover outline's. The outline is dropped
by anything that invalidates the tree — an input, a frame, a read that is slow or fails, all of
which are ordinary while recording — and a menu the user asked for explicitly must not be taken
away with one. The menu's concurrency is its own too (`menuToken`): only another right-click or a
dismissal cancels it, never a hover that happens to land during its read.
A coordinate is offered the tap and nothing else. There is nothing about a point to be visible, to
hold text or to scroll to, which is the refusal the recorder already made for a point assertion.
The menu says so in a line above the row: three rows missing with no explanation reads as a broken
menu rather than as an answer.

#### When nothing names the element uniquely

The ranking prefers a unique candidate over an ambiguous one — depth first, rank within a depth,
and the first candidate that resolves to exactly one element wins whatever its rank, for the element
under the pointer or for one enclosing it. So reaching the ambiguous case means *every* candidate
was ambiguous, which happens for real:

| element | role | unique selector |
| --- | --- | --- |
| the Settings **tab** | `tab` | `getByRole("tab", "Settings")` — matches 1 |
| the Settings **heading** | `text` | none |

`getByRole` does not accept `text`, so the heading has only its own text to go on, and the tab
carries the same text. Nothing narrows it either: `filter({ hasText })` is a substring of the same
text, `filter({ has })` has no distinguishing child to point at, and there is no ancestor to scope
under — on this app every content node's parent is the application root.

**So the step is narrowed by position.** `screen.getByText("Settings").nth(0)` runs on the device;
the bare selector fails with `LOCATOR_AMBIGUOUS: locator matched 2 nodes`. The index is the
position of the element the user actually pointed at among that selector's matches — the recorder
resolved that node, so it is recorded rather than guessed, and pointing at the *second* match
records `.nth(1)`. The match order is the snapshot's own: the projection flattens the tree depth
first and the panel passes it through untouched, so the panel's index and the runner's index are
the same index.

The honesty stays where it belongs. A position is more brittle than a name, so:

- the emitted line carries a note — not a TODO — saying how many elements match and that a testID
  would pin it by name. Nothing has to be edited for the test to work;
- the step list reads `Expect visible "Settings" (1 of 2)` and still flags it `ambiguous`, and the
  menu says how many match and that the step is pinned by position;
- the selector is still `ambiguous` as far as the panel is concerned, because it is.

The alternative was a step that fails and a note asking the user to go and edit it. A recorded test
that runs, with the user told exactly what is weak about it, is the better of the two.

### 7. Emitting and writing

`RecordedStep[]` is the single source of truth. Emitters are pure functions over it:

```ts
interface StepEmitter {
  readonly id: "e2e" | "maestro";
  emit(steps: RecordedStep[], meta: { title: string }): string;
}
```

The e2e emitter produces exactly the shape of a hand-written deterministic test:

```ts
import { test } from "@e2e-dev/mobile";
import { expect } from "e2e";

test("<title>", async ({ app, screen }) => {
  await app.open();
  await expect(screen.getByRole("tab", "Home")).toBeSelected();
  await screen.getByRole("tab", "Explore").tap();
  // …
});
```

No `agent.act` is ever emitted — the whole point of recording is determinism.

Writing needs a new **app-only** MCP tool in the server process:

- `mobile_testing_write_file({ projectRoot, relativePath, contents })`
- Annotated as a write so the host prompts; the panel must not be able to write anywhere by
  accident. Constrain `relativePath` to `tests/` under the chosen root, reject `..`, refuse symlinks.
- **It fires only when the user clicks Save, or when Run saves for them.** One tool call, one host
  prompt, per save — not per tap. This is what makes the permission story tolerable.

Running needs a second one, `mobile_testing_run_test({ projectPath, relativePath, timeoutMs? })`,
annotated destructive because a run drives the app and changes its state — so a host that prompts
on destructive tools prompts once per Run, which is the right granularity: a run is an explicit act,
not something that happens as you tap. It releases the recorder's
device session, spawns the **project's own** `node_modules/.bin/e2e` (never `npx`, which would go
to the network for a package that is not installed), and returns `{ status, exitCode, steps[] }`
with each step's `line`, `status` and first line of error.

While recording, the panel holds `RecordedStep[]` and renders the emitted source as a **live
preview** beside the step list, syntax-coloured by a tokenizer written for exactly the file the
emitter produces (`packages/ui/src/code-highlight.ts`) rather than a highlighting library — the
panel ships as one HTML file and a grammar would dwarf what it renders.

The lines a step adds are **tinted as they arrive** and fade back into the file. The user is
looking at the mirror when a step is recorded, not at the preview, so the new lines have to be
findable a second later. The file is re-emitted whole on every change, so "what is new" is
recovered by matching the previous render from both ends (`changedLines`); the marked lines are
keyed by a generation so each step animates, not only the first. The preview is always a full re-emit from the steps, so editing or
deleting a step just re-renders; nothing is ever half-written.

Save behaviour:

- **Record starts a new flow** when the steps on screen are already saved, and continues the
  existing one when they are not — stopping to scroll and carrying on is still one flow, but a tap
  landing on the end of a finished test never is.
- **A successful save stops the recording.** The flow is written; leaving the recorder armed turns
  the next stray tap on the mirror into a step the saved file does not have. The steps stay, so the
  flow can be extended and saved again. A save blocked by an existing file changes nothing.
- A filename field, defaulted from the test title (`tab-navigation` → `tests/tab-navigation.e2e.ts`).
- If the target exists, the panel says so and the user confirms an overwrite before the tool runs.
- The panel tracks a dirty flag: steps recorded since the last Save. Stopping or switching projects
  with unsaved steps warns.

Alternative considered and rejected: debounced live-write after every tap. It is what Maestro Studio
feels like, but each write is an MCP tool call and so a host permission prompt — unusable in a
recorder where a flow is thirty taps.

### 8. Replay

**Run test** saves the flow, hands the device back, runs the file with the project's own `e2e` CLI,
and marks each line of the preview with what the runner reports for it.

```mermaid
sequenceDiagram
  participant P as Panel
  participant S as Server
  participant R as e2e CLI
  P->>S: mobile_testing_write_file (asks before replacing)
  P->>S: mobile_testing_release_device
  P->>S: mobile_testing_run_test
  S->>S: devices.release() again
  S->>R: node_modules/.bin/e2e run <file> --reporter json
  R-->>S: the whole report, at the end
  S-->>P: steps[] with source.line and status
  P->>P: marks per line, held then faded on a pass
```

**Run saves.** The runner runs a file, so there has to be one, and running a copy in a temporary
path would run a test whose failures point at lines of a file the user cannot open. It saves
through the same path the Save button uses, so an existing file is still never replaced without
being asked about: the overwrite question stops the run, and answering it resumes the run rather
than making the user press Run twice.

**Run releases the device first, and waits.** agent-device allows exactly one session per device
and the recorder holds it, so a run spawned while it is held fails with `Device is already in use
by session "mobile-dev-recorder"` — a refusal the user cannot connect to anything they did. The
panel stops recording, awaits `mobile_testing_release_device`, and only then runs; the server tool
releases again on its own account, because a caller who forgets produces exactly that failure.
The release is a dependency of the run (`TestRunDeps` in `packages/core/src/testing-run.ts`), not a
step a caller is trusted to have taken, and it happens only after the runner binary resolves — a
project with no runner installed must not cost the user their recording session.

#### Where live per-step progress comes from

None of the CLI's four reporters gives it:

| Source | What it gives |
| --- | --- |
| `--reporter list`, TTY | deterministic steps appear only inside a live window it repaints |
| `--reporter list`, no TTY | a permanent line per **agent** step; a `locator.tap` or an `expect` never prints |
| `--reporter json` | the whole report document once, at the end |
| `.e2e/report.json` | written from `onRunFinished`; it does not exist mid-run |

But the runner's **event spine** does, and it is reachable without changing the runner:
`e2e.config.ts` accepts reporter *objects*, and a reporter's `onEvent` receives every `step` event
live, in the runner process, with `phase: "start" | "end"`. `--reporter` replaces only the built-in
reporters, so a configured object still runs beside `json`.

So a run is given a **generated config** that spreads the project's own and appends one reporter:

```mermaid
flowchart LR
  Panel -->|mobile_testing_run_test| Server
  Server -->|writes| Cfg[".e2e/mobile-dev-progress.config.mts"]
  Server -->|e2e run --config| Runner
  Cfg -.->|spreads| Base["the project's e2e.config.ts"]
  Runner -->|onEvent, tagged line on stderr| Server
  Panel -->|mobile_testing_run_progress, polled| Server
```

- The config is written **beside the project's own**, at the project root, and removed when the run
  ends — including on a timeout or a spawn failure. Not in `.e2e/`, tidy as that would be: the
  runner takes the project root from the config file's own directory, so a config one level down
  ends the run in `NO_TESTS: no test file matched "tests/**" under <project>/.e2e`.
- It spreads the project's config, resolving a config that exports a function, and puts its own
  reporters first. It adds a reporter and changes nothing else.
- Reporter **construction** has no side effects, because workers load the config too. Every write
  happens inside `onEvent`, wrapped in `try`, since a reporter that throws is quarantined for the
  rest of the run.
- Events come back as `@@mobile-dev-step <json>` lines on the child's stderr. No socket, no second
  temp file, and the runner's own stderr passes through untouched.
- A tool call is one request and one response, so the panel polls `mobile_testing_run_progress`
  every 400 ms while the run is in flight.
- If the runner refuses the generated config — an extension its loader will not take, a project
  config that does not survive being spread — the run is retried exactly as it was before live
  progress existed. A spinner is worth having and is not worth losing a run over.

**Mapping an event to a line.** A `step` event carries no source position — only the finished
report does — but it carries `identity.stepIndex`, and the runner reports one step per awaited call
in order. `EmittedTest.calls` is every awaited line in file order, `await app.open()` first, so the
index *is* the position in that list. The report reconciles it at the end, where each step carries
its own `source.line`, so a mismatch corrects itself rather than persisting.

The states are then:

- **nothing marked** until the runner says where it is. A spinner on every line would claim more
  than is known.
- **one line spinning** — the step that has started and not ended.
- **a mark behind it** for each step that has ended, with its own status.
- a pass holds its checkmarks for 2.5s and fades them; a failure's mark stays until the next run.
  Both respect `prefers-reduced-motion`, which drops the transition and keeps the mark.

The gutter is a **grid column**, not a character at the front of the line: each preview line is
`grid-template-columns: 1.35em minmax(0, 1fr)` with the mark and the code as siblings, and the mark
is exactly `1lh` tall so it centres on its line. That is what keeps the code from shifting when a
run starts and keeps a mark level with the first row of a line that wraps — and a long locator does
wrap.

If a run produces no report at all — the runner refused before it reached the test — there is no
line to mark, so the panel shows the runner's own output instead of going quiet.

#### Line spans

Attributing a report to a line needs to know which lines a step produced, and a step is not one
line: an ambiguous step carries a TODO above its call, and a coordinate tap carries a TODO *and* an
anchor gate, which the runner reports as a step of its own. `emitE2eTestLines` returns
`{ source, spans }`, where each span is `{ stepId, from, to, calls }` in 1-based file lines and
`calls` are the lines the runner will report a step for. `emitE2eTest` is that function's `source`,
so the preview, the saved file and the spans can never describe different files. The preview's
new-line animation still uses `changedLines` — good enough to flash a line, far too weak to decide
a pass or a failure.

## Reading the runner's tree

**The recorder reads the element tree the runner will query, not a second tree over the same
pixels.** `packages/core/src/testing-device.ts` takes an agent-device snapshot of the device —
`capture.snapshot({ interactiveOnly: false })`, the same call the runner's own locator path makes
— and projects it with the **project's own** `@e2e-dev/mobile` build, the one that will run the
test. The panel reaches it through `mobile_testing_read_tree`.

This replaces reading the macOS accessibility API through Baguette and translating its vocabulary
into the runner's with a table in `test-recording.ts`. That table was the bug, not the fix for it.
Two trees over the same pixels do not agree, and every way they disagreed reached the user as a
recorded test that simply did not resolve:

| | What iOS accessibility said | What the runner says |
|---|---|---|
| Tab bar item | `AXRadioButton` — a table had to guess `tab` | `tab`, derived from the tab bar around it |
| `<Text>` inside a `<Link>` | `AXLink`, from the link *trait* that any view can carry | `text`, from the XCUIElement *type* |
| Search field | name "Search transactions" (its placeholder) | no name; `placeholder` is "Search transactions" |
| A line of text and its wrapper | two matches, so "ambiguous" | one match, innermost |

Reading one tree makes all four agree **by construction** rather than by a mapping someone has to
maintain: role vocabulary and name sources are the engine's, and the recorder only chooses which
query to use. `normalizeRole`, `ROLE_ALIASES` and the fiber-versus-accessibility split are gone
with it, and so is the simulator-chrome filter — the runner's snapshot is rooted at the
application, so the clock and the Dynamic Island are not in it to filter.

It costs a snapshot per read (about 0.1 s in practice, measured against a booted iPhone 17 Pro),
against tens of milliseconds for a Baguette loopback. A tap holds the touch until the read
returns, and the recorder caches the tree for 1.5 s and invalidates it on every input, so a warm
tree answers a hover or a walk without a round trip.

### Baguette still owns the mirror

Only the recorder's *read* path moved. Video frames and touch injection are unchanged, and the
two hold the same simulator at once: with the mirror streaming, a snapshot returns in about a
tenth of a second, the stream stays open and a frame arrives for the change the snapshot's own tap
caused.

### The session, and giving it back

Reading holds an agent-device session on the device, and **agent-device allows exactly one session
per device**. A session left open makes the user's next `npx e2e run` fail with `Device is already
in use by session …` — a refusal they cannot connect to anything they did, and a worse failure
than any this path fixes. So the device is released on every path out of recording: stopping,
detaching, a device that changes under the recorder, the panel being disposed, and **Run**, which
waits for the release before it spawns anything (`RecorderReader.release`,
`TestingDevices.release`).

A session is also released when the **server shuts down**, which is the path none of those cover.
The claim record agent-device writes names the daemon that holds it, and that daemon outlives the
server process. A server that dies without releasing therefore leaves a claim behind on a daemon
nobody is talking to any more, and the user's own `e2e run` then refuses to boot the device:

```
ERROR  infrastructure error ENGINE_FAILURE (launch)
boot failed: iPhone 17 Pro has an ownership claim that could not be verified.
```

This is the same leak as `Device is already in use`, wearing a worse message, and the user has even
less to connect it to — the panel they closed is gone. `registerTestingTools` returns the release as
the plugin's shutdown for that feature, and `plugin.close()` awaits it beside the other collectors.
When it does happen (a hard kill releases nothing), the way out is the CLI the daemon was started
by, on the same state directory:

```bash
AGENT_DEVICE_STATE_DIR="$HOME/Library/Application Support/mobile-dev/app-flow/agent-device" \
  <plugin>/dist/agent-device/node_modules/.bin/agent-device close --session mobile-dev-recorder
```

Attaching names the bundle id and passes `relaunch: false`. Never `--foreground`, which refuses
outright when more than one app is running on the simulator, and never anything that relaunches:
the recorder exists so the user keeps tapping the screen they are already on.

## Maestro, later

Nothing above is e2e-specific except the emitter and the run command. Adding Maestro means:

- a `MaestroEmitter` producing YAML (`- tapOn: { id: … }`),
- a run path through the existing agent-device script-replay tool,
- a format switch in the panel.

The selector ranks map cleanly: `identifier` → `id`, text → `text`, point → `point`.

## Resolved against e2e v0.17.0

- **`screen.tapAt(point, options?)` exists** (`e2e/dist/types.d.ts:296`), with the point in CSS
  pixels. Rank 4 of the selector table is valid as written.
- **No `e2e config --json`.** The CLI has `init`, `login`, `logout`, `models`, `guide`, `mcp`,
  `run`, `explore`, `list`, `cache`, `feedback`, `telemetry`. `e2e list --reporter json` prints
  `{ pairs: [...] }` — test/target pairs, which confirms a folder is an e2e project and names its
  targets, but does not expose the bundle id.
  So: validate the project with `e2e list --reporter json`, and get the bundle id by reading
  `e2e.config.ts` with a light regex, falling back to asking the user once and caching it.
  Parsing the config properly would mean executing TypeScript in the server process — not worth it.

## Open questions

None blocking.

## Build order

1. ~~Tab + empty panel registered in all hosts.~~ Done: `testing` in `toolNames`
   (`packages/ui/src/workspace-tools.ts`), the tab in `packages/mcp-app/src/components/workspace.tsx`,
   `TestingPanel` (`packages/ui/src/testing-panel.ts`) and `TestingView`
   (`packages/ui/src/components/testing-view.tsx`).
2. ~~Project picker + launch, no recording.~~ Done: `mobile_testing_projects`,
   `mobile_testing_choose_project` and `mobile_testing_project_config`
   (`packages/core/src/testing-tools.ts`, `packages/core/src/testing-projects.ts`), with launch
   going through the existing `mobile_launch_app`.
3. ~~Tap recording with selector resolution, step list and live source preview in the panel.~~
   Done: `TestRecorder` (`packages/ui/src/test-recorder.ts`) with the pure selector and emitter
   logic in `packages/shared/src/test-recording.ts`, taps intercepted on the mirror canvas in
   `packages/ui/src/simulator-panel.ts`, and the step list and preview in `TestingView`.
   Right-click on the mirror opens the element menu (step 5), which records the steps a tap
   cannot express without forwarding a touch.
4. ~~`mobile_testing_write_file` + the Save button and overwrite confirmation.~~ Done:
   `writeTestFile` and `resolveTestPath` (`packages/core/src/testing-projects.ts`) confine the
   write to the project's `tests/`, refuse `..`, a non-`.e2e.ts` name and a symlinked folder or
   file, and report an existing file back instead of replacing it; `TestingPanel.saveTest`
   asks before overwriting and tracks saved-versus-dirty against the recorder's revision.
5. ~~Assertions, typing, long press, scroll — through the element menu.~~ Done: `stepOffers` and
   `stepExpression` (`packages/shared/src/test-recording.ts`) derive the rows from the element's
   role and state; `TestRecorder.openMenu`/`chooseOffer` resolve and record them at the outline's
   walked-out level; `ElementMenu` (`packages/ui/src/components/test-recorder-overlay.tsx`) draws
   them over the mirror from the `contextmenu` wired in `packages/ui/src/simulator-panel.ts`. The
   global Assert toggle and its tests are gone.
6. ~~Run button.~~ Done: `mobile_testing_run_test` and `runRecordedTest`
   (`packages/core/src/testing-tools.ts`, `packages/core/src/testing-run.ts`) release the device as
   a dependency of the run and turn the report into per-line status;
   `TestingPanel.runTest` saves first and resumes from the overwrite answer; the marks are
   `TestRunView` on the recorder and the gutter in `TestPreview`.
7. Swipe recording (a drag on the mirror, which currently records nothing).
8. Maestro emitter.
