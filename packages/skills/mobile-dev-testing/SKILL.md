---
name: mobile-dev-testing
description: Use when the user asks to record, write or capture an end-to-end test for a screen or a flow of their iOS or Android app, with Mobile Dev's Testing panel. Drives the simulator or emulator through Mobile Dev's recorder one step at a time, pinning each step to a locator the e2e runner can resolve, and leaves the flow in the panel for the user to adjust, save and run. Skip when the user wants a test written straight into a file, or when there is no Mobile Dev panel.
---

# Record an e2e test with Mobile Dev

The user asks for a test for a screen — *"record the test for the important areas on the Explore
Details screen"* — and you write it by driving their simulator or emulator, one step per tool call. The steps
appear in Mobile Dev's **Testing** tab as you record them, and when you stop, the flow is sitting
there unsaved for the user to adjust.

You record. The user saves and runs. Those two are theirs, and the tools to do them are not yours
to call.

## Before you start

The recording goes against whatever the Testing panel already has selected: an **e2e project**, a
**booted iOS simulator or Android emulator in the mirror**, and a **target with a bundle id** in that project's
`e2e.config.ts`. `mobile_testing_agent_begin` reads that selection and refuses, naming what is
missing, when any of the three is unset.

If it refuses, say which one is missing and ask the user to set it in Mobile Dev's Testing tab.
**Never choose the project for them** — the picker is a system folder dialog, which must not open
in the middle of your turn — and do not reach for another device because the chosen one is not
booted. Open the panel with `mobile_open_simulator` if it is not open, and otherwise stop and ask.

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
   is waiting in the Testing panel.

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

- **Never save.** There is no tool for it in your hands, and finishing is the handover: the steps
  are dirty in the panel and the user presses Save when they are happy with them.
- **Never run the test.** There is no file to run, and a run resets the app and takes the device
  session the recording is being read through.
- **Never drive the device another way while recording** — not `device_*`, not `mobile_open_url`,
  not the mirror. The recorder's steps and another driver's taps interleave into a flow that does
  not describe anything. Everything the flow does goes through `mobile_testing_agent_step`, which
  is what makes each action a recorded step.

## When you are done

Tell the user what you recorded, in their terms, and that it is **in the Testing panel, unsaved**.
Say which parts fell back to a sentence, if any, and why. Do not paste the emitted file as the
deliverable — the panel is showing it, live, next to the steps.
