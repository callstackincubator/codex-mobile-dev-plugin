---
title: Testing Studio
description: Record, edit, and run deterministic e2e tests from an iOS simulator, connected iPhone or iPad, or Android emulator beside your conversation.
---

Open **Testing Studio** to turn interactions with a running app into an editable e2e test. The mirror, generated TypeScript, and ordered step list share one workspace, so you can drive the app and review the test at the same time.

Testing Studio supports iOS simulators, connected and paired iPhones and iPads, and Android emulators. Physical Android devices and Maestro output are not supported.

## No project, or your own project

You don't need an e2e project to start. Testing Studio works in two modes, and the **E2E setup** button in the toolbar shows which one is active.

| Mode | When | What runs the test | Where tests are saved |
|---|---|---|---|
| **No project** | Nothing is open, or the folder has no usable `e2e.config.ts` | Mobile Dev's bundled e2e runtime | Mobile Dev's private storage, listed under **In Testing Studio** |
| **Project** | A folder with an `e2e.config.ts`, a mobile target with a bundle ID, and the project's own `e2e` CLI installed | The project's own e2e CLI and `@e2e-dev/mobile` | The project's `tests/` directory |

In Codex, opening Testing Studio in **No project** mode downloads the runner once for this plugin version. You can follow the download in the tab and retry there if it fails. Later sessions use the cached runner offline.

In **No project** mode the test runs against the app in front of the mirror, and each saved test remembers that app, so later runs open the same one. Nothing is written to any of your folders.

In **Project** mode Mobile Dev never installs or replaces your test runner, and a run never downloads a CLI with `npx`.

The **E2E setup** popover lists the project, mobile apps, devices and agent model. Its sections start collapsed; open the one you need. **Set up project** walks you through creating a config in a folder that has none, and **Update setup** changes an existing one.

## Prepare a device

1. Boot an iOS simulator or Android emulator, or connect and pair an iPhone or iPad, then select it in Mobile Dev.
2. Open **Testing Studio**. Choose a project folder from the picker, or stay on **No project**.
3. In a project, choose a target whose platform matches the mirrored device.
4. Select **Launch app**.

**Launch app** opens an app that is already installed; it doesn't build one. If the app is missing, build and install it for the selected device. For an Expo app, use `npx expo run:android` for an emulator or `npx expo run:ios --device` for a connected iPhone or iPad. A simulator build cannot be copied to physical hardware.

## Record a test

Select **Record**. The mirror briefly shows that the recorder is preparing while it reads the element tree used by the mobile test engine.

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

Open **Test Description** to set the test title and file name. **Save** writes the test to the project's `tests/` directory, or to Mobile Dev's storage in **No project** mode. Mobile Dev refuses paths outside that directory and asks before replacing an existing file.

**Run test** releases the recorder's device session and starts the runner. The preview marks each step as it starts and finishes, then shows the verdict and duration.

Saved tests are listed under **In the project** or **In Testing Studio**. Open one to preview its source, edit a temporary working copy, save or undo those edits, run the full file, or play to one step. Saving refuses to overwrite a file that changed on disk after you opened it.

## Run on several devices

Open **E2E setup → Devices** to pick where a test runs. The list shows iOS simulators, connected or remembered iPhones and iPads, and Android emulators. Physical iOS rows show connection and app installation status; disconnected or unpaired hardware cannot be selected.

- Tick two or more devices and **Run test** becomes **Run on N devices**. Each device runs the same test in its own lane, with its own steps, verdict and **Cancel**.
- Tick one device that isn't the mirrored one and the test runs there (**Run on iPhone Air**).
- **Run up to N at once** sets how many devices work at the same time, from 1 to 8. The rest wait in a queue.
- A simulator or emulator that is off is booted first.
- A simulator or emulator without the app gets it copied from another booted device of the same platform that has it, even one you didn't tick. On a phone or tablet, Testing Studio never copies a simulator app. If the app is missing it installs a matching `Debug-iphoneos` build it finds on this Mac (your project's `ios/build` or Xcode's DerivedData), and otherwise asks you to run `npx expo run:ios --device` first.
- iOS and Android devices can run in the same batch. In a project, each device runs the config's target for its platform.

Click a lane to see that device's steps on the preview. A failure on one device doesn't stop the others. Each `agent.*` step calls the model once per device.

Running a project's test on several devices requires each mobile target's engine to be written as a `mobile({ ... })` call directly in `e2e.config.ts`. Mobile Dev runs each device with a temporary copy of the config pinned to that device, and removes the copy when the run ends.

## Unsaved recordings

Recordings that have not been saved appear under **Not stored**. Mobile Dev keeps them in its own application-support directory, scoped to the selected project, so switching tools or chats does not discard the flow. Saving moves the flow into the test list. Deleting an unsaved recording or a saved test asks for confirmation because neither action can be undone in the panel.

## Ask your agent

Keep **Testing Studio** open, then ask your coding agent, for example:

> Use the opened iOS app and record a test for searching the city list.

> Run that test on iOS and Android side by side.

The agent records against the app in the mirror, adding one step at a time while you watch. Manual input is locked during that session so two drivers can't act on the same screen.

In **No project** mode the agent saves the finished test and can run it on several devices. If a platform has no app yet, the agent asks you to open it, picks it up, and runs on both. If a step fails on one device because a locator changed, the agent can replace that locator and run again; it never weakens or removes an assertion.

In a project, the recording stays unsaved for you to review, adjust and save.

## Data and telemetry

Test source, step contents, element names, labels, typed values, project paths, bundle IDs, and device identifiers are excluded from Mobile Dev telemetry. Aggregate timings and counts cover recorder preparation, element-tree reads, editing, runs, and agent-recording handoff. See [Privacy](/docs/privacy) for collection and opt-out details.

## Physical iPhone and iPad setup

Recording and replay on hardware run an XCTest runner on the device, which has to be code signed.

- **Developer Mode** must be on (Settings → Privacy & Security → Developer Mode), and the phone unlocked and trusted. Testing Studio checks Developer Mode before a run and says what to turn on.
- **Signing team.** Mobile Dev picks your Apple Developer Team ID in this order: `MOBILE_DEV_IOS_TEAM_ID` (or `AGENT_DEVICE_IOS_TEAM_ID`) in Mobile Dev's environment, then the project's `DEVELOPMENT_TEAM`, then the single team behind your Apple Development certificates. With none or several it stops and asks you to set `MOBILE_DEV_IOS_TEAM_ID`. Find the ID with `security find-identity -v -p codesigning`.
- The runner is built as `com.mobiledev.agentdevice.<team id>` so it is unique to your team. Set `AGENT_DEVICE_IOS_BUNDLE_ID` to use your own, and `AGENT_DEVICE_IOS_PROVISIONING_PROFILE` when Xcode cannot pick a profile.
- A failure carries the fix agent-device reports, such as the signing or Developer Mode hint, without local paths.
- One runner per phone: a device that is already running a test is refused until it finishes.
