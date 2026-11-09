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
  Canvas[Mirror canvas] -->|pointerdown x,y| Rec[TestingPanel recorder]
  Rec -->|mobile_testing_read_tree| Tree[agent-device snapshot, projected by @e2e-dev/mobile]
  Tree --> Hit[hit ladder]
  Hit --> Step[RecordedStep]
  Rec -->|mobile_stream_input| Device[Simulator]
  Step --> Emit[E2eEmitter]
  Emit -->|mobile_testing_write_file| File[project tests/*.e2e.ts]
  Step --> View[Step list beside the mirror]
```

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

- **Swipe**: `pointerdown`→`move`→`up` with distance over a threshold → `screen.swipe(...)`,
  anchored on the component under the start point when one resolves.
- **Typing**: key messages already flow through `stream-input`. Coalesce a run of keystrokes into
  one `.fill("…")` on the focused field; `type_secret`-style values must never be written to the
  file — emit a placeholder and a comment.
- **Long press**: `pointerdown`/`up` delta over ~500 ms.

### 6. Assertions

A recorder that only taps produces worthless tests. Two affordances:

- An **Assert** mode button: the next click on the mirror does not forward input; it picks the
  component under the cursor and emits `await expect(<selector>).toBeVisible()` (or
  `.toBeSelected()` for a selected tab, `.toHaveText(...)` when the node has text).
- Auto-insert `await expect(<selector>).toBeVisible()` before each tap, behind a toggle. This is
  what makes a recorded flow fail at the right step instead of three steps later.

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
- **It fires only when the user clicks Save.** One tool call, one host prompt, per save — not per
  tap. This is what makes the permission story tolerable.

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

A **Run** button in the panel shells `npx e2e run tests/<file>` in the project root and streams the
result into the step list, marking the step that failed. This closes the loop: record, run, fix the
selector, run again.

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
detaching, a device that changes under the recorder, and the panel being disposed
(`RecorderReader.release`, `TestingDevices.release`).

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
   The Assert button records `toBeVisible()` without forwarding the touch.
4. ~~`mobile_testing_write_file` + the Save button and overwrite confirmation.~~ Done:
   `writeTestFile` and `resolveTestPath` (`packages/core/src/testing-projects.ts`) confine the
   write to the project's `tests/`, refuse `..`, a non-`.e2e.ts` name and a symlinked folder or
   file, and report an existing file back instead of replacing it; `TestingPanel.saveTest`
   asks before overwriting and tracks saved-versus-dirty against the recorder's revision.
5. Assertions, swipe, typing.
6. Run button.
7. Maestro emitter.
