---
title: Testing
description: Record, edit, and run deterministic e2e tests from an iOS simulator or Android emulator beside your conversation.
---

Open **Testing** to turn interactions with a running app into an editable e2e test. The mirror, generated TypeScript, and ordered step list share one workspace, so you can drive the app and review the test at the same time.

Testing currently supports iOS simulators and Android emulators with an existing e2e project. Physical devices and Maestro output are not supported. Mobile Dev uses the project's own e2e CLI and `@e2e-dev/mobile` installation; it does not install or replace the project's test runner.

## Prepare a project and device

Before recording:

1. Install the project's dependencies and configure an `e2e.config.ts`, `.mts`, `.js`, or `.mjs` file.
2. Boot an iOS simulator or Android emulator and select it in Mobile Dev.
3. Open **Testing** and choose the project folder. Mobile Dev remembers recent choices, but never infers a project from the server's working directory.
4. Choose a target whose platform matches the mirrored device, then select **Launch app**.

The target needs a bundle ID in the e2e config so Mobile Dev can attach the recorder to the same app the test will open. If the selected target and device use different platforms, choose a matching target before recording.

## Record a test

Select **Record**. The mirror briefly shows that the recorder is preparing while it reads the element tree used by the project's own mobile test engine.

While recording:

- Click the mirror to use the app without adding a step.
- Right-click an element to open the commands it supports.
- Choose a tap, text entry, swipe, scroll, or assertion. Commands that need text ask for it before adding the step.
- Scroll over the outline to move from a nested element to the element around it.

Mobile Dev prefers stable role, name, label, placeholder, and test-ID selectors. If several elements match, the generated locator records the selected position. A point that cannot be named can still produce a coordinate tap, but the preview marks that fallback so you can decide whether the app needs a stable test ID.

The app performs action steps as they are recorded. Assertions only inspect the screen. Select **Stop** when the flow is complete; the steps and preview remain available.

## Edit and organize steps

The step list is the source of truth for a recording. You can:

- reorder or duplicate a step;
- change a step to another command supported by the same element;
- remove individual steps or clear the flow after confirmation;
- edit the generated source directly when the structured step editor is not enough.

Hovering or focusing a step highlights the lines it generated. The source preview also offers **Play until here** on executable lines, which runs a temporary shortened copy without changing the saved test.

## Save and run

Open **Test Description** to set the test title and file name. **Save** writes the test below the selected project's `tests/` directory. Mobile Dev refuses paths outside that directory and asks before replacing an existing file.

**Run test** saves pending recording changes, releases the recorder's device session, and starts the project's local e2e CLI. The preview marks each reported step as it starts and finishes, then shows the runner's verdict and duration. A run never downloads a CLI with `npx`.

Tests already in the project appear under **In the project**. Open one to preview its source, edit a temporary working copy, save or undo those edits, run the full file, or play to one step. Saving refuses to overwrite a file that changed on disk after you opened it.

## Unsaved recordings

Recordings that have not been written into the project appear under **Not stored**. Mobile Dev keeps them in its own application-support directory, scoped to the selected project, so switching tools or chats does not discard the flow. Saving moves the flow into the project's test list. Deleting an unsaved recording or a project test asks for confirmation because neither action can be undone in the panel.

## Ask your agent to record

You can ask your coding agent to record a screen or flow, for example:

> Use Mobile Dev to record an e2e test for searching the city list.

Choose the project, device, and target first. The agent opens Testing, reads the same runner-projected element tree, and adds one step at a time while the mirror shows the app changing. Manual input is locked during that session so two drivers cannot act on the same screen.

When the agent finishes, its steps stay as an unsaved recording. The agent does not save or run the test; review the flow, adjust it, and choose when it should enter the repository.

## Data and telemetry

Test source, step contents, element names, labels, typed values, project paths, bundle IDs, and device identifiers are excluded from Mobile Dev telemetry. Aggregate timings and counts cover recorder preparation, element-tree reads, editing, runs, and agent-recording handoff. See [Privacy](/docs/privacy) for collection and opt-out details.
