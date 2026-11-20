---
name: mobile-dev-testing
description: Use when the user asks to record, write or capture an end-to-end test for a screen or a flow of their iOS or Android app, with Mobile Dev's Testing Studio panel. Drives the simulator or emulator through Mobile Dev's recorder one step at a time, pinning each step to a locator the e2e runner can resolve, and leaves the flow in the panel for the user to adjust, save and run. In No project (Testing Studio) mode it also saves, runs on one or several devices, iOS and Android side by side, and repairs a failing line's locator for one platform. Skip when the user wants a test written straight into a file, or when there is no Mobile Dev panel.
---

# Record an e2e test with Mobile Dev

The user asks for a test for a screen — *"record the test for the important areas on the Explore
Details screen"* — and you write it by driving their simulator or emulator, one step per tool call. The steps
appear in Mobile Dev's **Testing** tab as you record them, and when you stop, the flow is sitting
there unsaved for the user to adjust.

In a **project**, you record; the user saves and runs. Those two are theirs, and the tools to do
them are not yours to call. In **No project (Testing Studio) mode** the flow is yours end to end: see
[Testing Studio mode](#studio-mode-record-run-repair) below.

## Before you start

The **Testing Studio tab must be open**; it is how Mobile Dev knows the user is looking. You open it
yourself: whenever `begin` or a run tool says the Testing Studio tab is not open, call
`mobile_open_simulator({ workspaceTool: "testing", projectPath })` (it also switches an open view to
that tab) and then call the tool again. Do not ask the user to open it; the call waits for the tab to
report in. **Open it once per chat.** The host draws a new Mobile Dev panel for every
`mobile_open_simulator` call, so a second call leaves two panels. Booting devices, recording, running
and matrix runs never need it again and never open one; if a tool still says the tab is not open after you
opened it, it is hidden or on another tab: ask the user to show it instead of opening another. **Always pass `projectPath`: your workspace root (working directory), or `""` when the
chat has no project.** The tab then follows the chat: a folder that is not a mobile project (a
scratch folder, such as a Codex `Documents/Codex/<date>/...` one) selects No project, so recording
uses the app in the foreground; a project is selected and added to the list when missing. Never
pick a project from the tab's picker yourself, and never mention a project the chat does not have.
Past that,
`mobile_testing_agent_begin` picks what is unambiguous and tells you in `picked`, so relay that to the
user in a line:

- **Device**: the one the mirror shows, else the only booted simulator or emulator.
- **App**: in **No project (Testing Studio) mode**, the app in the foreground (home screens and launchers
  do not count); finishing saves the test pinned to it. In a **project**, the config target the
  foreground app matches, else the project's only target for that platform.

Never ask the user for a project, device or target up front, and never pass them to `begin`. If it
refuses, the message names only what is missing, with one action each. Do those yourself when you
can: boot a simulator (`mobile_boot_simulator`) or, if no panel is open yet, open it with `mobile_open_simulator`, then
`begin` again. Ask the user only when the message says to: which of several devices or targets, an
app that must be opened or installed by hand, or a decision only they can make. **Never choose the project for them** — the picker is a system folder dialog, which must not open in the middle of your turn — and do not reach for another device because the chosen one is not booted.

The app should already be on screen. The recorder attaches to the running app and never relaunches
it, so a flow recorded from a cold home screen is a flow the user will have to fix.

## The loop

1. `mobile_testing_agent_begin({ title, goal })` — one short title for the test and one sentence
   on what the flow covers. The goal is what the user sees in the panel's banner, so write it for
   them.
2. `mobile_testing_agent_screen({})` — the element tree of the screen you are on. One row per
   element with its role, name, text, placeholder, value, testId, state and bounds, **and the
   selector a step on it would emit**, its rank, and whether it is unique.
3. Pick a `ref` from that read and call `mobile_testing_agent_step`.
4. **Read the screen again after every step that acts.** Every tap, fill and swipe changes the
   screen, so the refs from the last read go with it; a stale `ref` is refused rather than acted
   on. An assertion changes nothing, so several in a row need only one read.
5. `mobile_testing_agent_finish({ note })` when the flow is complete, and tell the user the flow
   is waiting in the Testing Studio panel.

Use `mobile_testing_agent_abort({ reason })` if you cannot finish — a screen you cannot reach, an
app that crashed. Whatever you recorded stays in the panel for the user.

## Never write a locator

You name a `ref`; the panel resolves the selector. The read already tells you what it would emit
and whether it is unique, which is the only thing you need to judge:

| The read says | What to do |
| --- | --- |
| `unique: true` | Record the step on that `ref`. |
| `unique: false` | The selector matches more than one element and the step is pinned by position. Prefer a different element that is unique — the row's parent, a nearby testId — and only then record this one. |
| no `selector` at all | Nothing on the screen names that element. Record it as a sentence: `mobile_testing_agent_step` with an `instruction` and no `ref`. |
| `offScreen: true` | It is below the fold or behind the keyboard. `getByText` still resolves it, so it is fine to **assert** on; a tap on it is refused by the device. Record a swipe first if you need to act on it. |

A sentence becomes `agent.act` or `agent.assert`, which the runner resolves with a model at run
time. It is the fallback, not the tool: the point of a recorded test is that it is deterministic,
and a flow that is half sentences is a flow the user could have written by prompting. If you reach
for more than one or two in a flow, the screen needs testIDs and that is worth saying.

## What to record

The test starts from `app.open()`, so **the navigation to the screen is part of the flow** and is
recorded like everything else: tab, button, row, until you are where the user asked for.

Then, on the target screen:

- its **landmarks** as assertions — the heading, the section titles, the one piece of copy that
  says the right data loaded;
- its **one or two real affordances** exercised — the search field filled, the filter tapped, the
  disclosure opened;
- the **result** of each asserted, which is what makes it a test rather than a transcript.

Keep a flow under about fifteen steps. A long flow is two tests, and the second one is a second
`begin` after you have finished the first.

A control you **open** is part of the screen, so assert what it revealed — and close it again if
the screen is meant to be left as you found it. A disclosure left open is a screen the next step
resolves against and the test will not reach.

## Where the flow ends

**The screen the user named is the scope of the recording, not the place it starts.** Getting there
is recorded because the test has to start from `app.open()`; everything after you leave it is
somebody else's test.

- You may tap a control that **navigates away**, and assert the arrival with **one** assertion —
  that is how the screen's own navigation gets covered. Then the flow **ends**. Record nothing on
  the screen you arrived at: not its heading, not its fields, not its search.
- A step's result says `navigated: true` when the action replaced the screen. Treat it as the
  boundary it is: assert you arrived, then `mobile_testing_agent_finish`.
- **A flow name is not a boundary.** "Record the checkout flow", "record signing in" — the flow is
  the scope, and crossing screens is the whole of it. A *screen* name is a boundary; a flow name is
  not. When the user's words name neither clearly, ask rather than guess wide.
- Say what you left out instead of recording it: *"I stopped at Explore List — say the word and
  I'll record that screen too."* A sentence costs nothing; six steps about the wrong screen cost
  the user an edit.

Assert text the screen actually carries, copied from the read — not text you expect it to carry. If
the thing you want to assert is not in the read at all, record `{ kind: "swipe", direction: "up" }`
with no `ref` to scroll the viewport and read again; if it still is not there, say so rather than
asserting text you have not seen.

## What you never do

- **Never save** a project's test. There is no tool for it in your hands, and finishing is the
  handover: the steps are dirty in the panel and the user presses Save when they are happy with
  them. (Testing Studio mode's `finish` saves for you; that is the one exception.)
- **Never run the test** while recording. There is no file to run, and a run resets the app and
  takes the device session the recording is being read through.
  When the user asks for a saved test to run on several devices, that is `mobile_testing_run_matrix`,
  and it works in both modes: a Testing Studio test runs on each device with the bundled runner, and a project
  with its own `e2e.config.ts` runs the config's target for each device's platform (a device missing
  the app gets it copied from another booted device that has it, and the target's engine must be a direct
  `mobile(...)` call). It is a run, so
  never during a recording.
- **Never drive the device another way while recording** — not `device_*`, not `mobile_open_url`,
  not the mirror. The recorder's steps and another driver's taps interleave into a flow that does
  not describe anything. Everything the flow does goes through `mobile_testing_agent_step`, which
  is what makes each action a recorded step.

## When you are done

Tell the user what you recorded, in their terms, and that it is **in the Testing Studio panel, unsaved**.
Say which parts fell back to a sentence, if any, and why. Do not paste the emitted file as the
deliverable — the panel is showing it, live, next to the steps.

## Testing Studio mode: record, run, repair

No project open — the Testing Studio tab says Testing Studio — means tests live in Mobile Dev's own storage, each
pinned to an app. The tab must be open: every tool below reads the tab's selection and refuses
when it has none. Then, if you have not opened the panel yet this chat, open it yourself with `mobile_open_simulator({ workspaceTool: "testing", projectPath })` and
call the tool again; do not ask the user, and do not open a second panel. `projectPath`
is optional on all of them; it defaults to the tab's project.

### Record, which saves

*"Use the opened iOS app and record a test."* Run the loop above. In Testing Studio,
`mobile_testing_agent_finish` **writes the test**, pinned to the platform and bundle id it was
recorded on, and returns its `relativePath` (e.g. `tests/the-explore-screen.e2e.ts`). Tell the
user the path. Nothing in the test file names a platform until you branch a line.

### Run

- One device, or a quick check: `mobile_testing_run_test({ relativePath })`. It waits for the end.
- Several devices, iOS and Android side by side: `mobile_testing_run_matrix({ relativePath, devices })`
  with a `{ deviceId, platform }` per device, from the device lists. It returns a `matrixId`
  at once; read `mobile_testing_run_progress({ matrixId })` until `running` is false. `apps`
  defaults to the apps the test is pinned to.
- **Devices that are off are booted by the matrix**, and an app missing from a device is copied
  from another device in the run that has it. Do not boot or install first.
- The runs show in the Testing Studio tab as live lanes, and the tab is locked while they go.

### A platform has no app yet

`run_matrix` refuses a platform the test has no app for. Then:

1. Tell the user to **open the app on a device of that platform**.
2. `mobile_testing_wait_for_app({ platform })`. It returns the foreground app's `bundleId`. If it
   times out, relay its message and stop.
3. `mobile_testing_set_target({ relativePath, platform, bundleId, mode: "add" })`. Do this
   **without asking**, then tell the user which id you added.
4. Run again.

A device that needs the app opened or installed by hand is the only reason to ask the user to do
anything on a device. Boot it and copy the app yourself when you can.

### A lane fails

A failed lane carries `failure`: the `line`, its `source` and `error`, and the device's screen as
rows ending in the locator each would be written with (`button "Sign in" → screen.getByRole(…)`).
Repair that platform's line and nothing else:

1. Pick the row that names the element the line meant — the same control, never a different one.
2. `mobile_testing_branch_line({ relativePath, line, platform, locator })`, with that lane's
   `platform` and a locator copied from its rows. The other platform keeps its locator.
3. Run again. **At most two tries per failure.** After the second, stop and report a likely app
   bug: the line, the error, and what the screen showed.

**Never weaken or remove an assertion** — not by changing its kind, loosening its text, deleting it
or skipping the step. A fix swaps a locator and nothing more. If the element is not on that
platform's screen at all, that is the bug to report, not a locator to find.
