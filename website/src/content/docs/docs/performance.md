---
title: Performance
description: Record app CPU and memory alongside supported device Display FPS, inspect selected ranges, and compare before-and-after runs with your agent.
---

Open **Performance** to follow the selected app's CPU and memory, with device-wide Display FPS where supported. Ask your agent to record a repeatable interaction, inspect a range, or compare runs.

## Live monitoring

CPU and memory collection starts for the foreground app when it is eligible. Choose another running app in Performance settings to monitor it explicitly. The selected source follows the device you click or focus, and each device remembers its chosen app.

Expand the CPU track for individual threads. Drag a chart to select a time range, and choose **Follow live** to return to the rolling view. The live history keeps 150 seconds of samples; missing readings remain gaps.

Stopping collection or closing the tools panel leaves the app running. A new app process starts a fresh history.

## Record an interaction

Ask your agent:

> Record CPU and memory for 30 seconds while I scroll checkout.

Timed recordings attempt CPU, memory, and device-wide Display FPS together. The default duration is 30 seconds, with a maximum of 300 seconds. Wait until the recording is ready before performing the interaction; the duration starts when the collectors are ready.

The recording stops and saves automatically, and can continue without an open panel. The agent can finish it early if needed. Only metrics with recorded readings appear in the saved charts.

## Read the measurements

| Measurement | Meaning |
| --- | --- |
| CPU | App process and thread CPU. 100% means one occupied device CPU core, so a process can exceed 100%. |
| Memory on Android | Resident set size (RSS), including shared resident pages in full. |
| Memory on iOS | Physical footprint, including compressed memory. It is not equivalent to Android RSS. |
| Display FPS | Updates of the entire device display, including other apps and system UI. It does not isolate one app or measure the streamed panel's refresh rate. |

Memory is shown in MiB. Display FPS can be zero on a quiet or locked screen; a missing measurement is shown as a gap. Rapid-change highlights identify where values vary, not what caused that variation.

## Supported devices

| Device | CPU and memory | Display FPS |
| --- | --- | --- |
| iOS simulator | Supported with the selected full Xcode installation | Unavailable |
| Physical iOS | iOS 17.4 or later, a running development-signed app with `get-task-allow`, pairing, Developer Mode, a mounted developer disk image, and Xcode/LLDB detached | iOS 17.4 or later with Developer Mode |
| Android | A connected device that allows ADB access to the app's process counters | Android 12 or later with FrameTimeline support |

Physical iOS CPU monitoring briefly pauses the app when attaching and detaching. Android CPU monitoring requires neither root nor an app SDK, and can monitor release builds when the device permits counter access.

## Inspect a saved run

Saved recordings appear as interactive cards where the host supports MCP Apps. Drag any chart to select the same interval across CPU, memory, and FPS. Clear the selection to restore the full run.

Choose **Ask about this range** to send the original recording reference and exact interval to the agent. **Open in Mobile Dev** opens the saved run and selection in the Performance panel without starting a new collector. These chat actions depend on the host's message capabilities.

The agent reads the original samples to answer questions. Use [Profiles](/docs/profiles) when you have a CPU or React profiling export and need to explore its call tree or component work.

## Android frame pacing and jank

Android recordings with FrameTimeline support include detailed display frames, jank rate, frame-interval percentiles, dropped frames, and classification coverage.

These describe device-wide compositor frames, not Android Vitals app metrics. A low jank rate with incomplete classification coverage does not establish that a run was smooth. Display readback is delayed, so a completed recording can briefly finish collecting late frame data before saving.

## Compare changes

Ask the agent to compare two to six completed recordings. Runs align at their start without stretching their timelines. Select a shared range to compare CPU, memory change, FPS, and available frame statistics. Failed runs retain available samples and are labeled as partial.

Repeat the same interaction on the same device and app configuration for a meaningful before-and-after comparison. Whole-run averages can cover different durations, and Android RSS and iOS physical footprint are displayed separately.

## Saved data

Completed and failed runs are stored as private JSON files under `~/Library/Application Support/mobile-dev/recordings`. They survive plugin restarts and are not automatically deleted. A forcibly terminated process can lose an unfinished run.

Device performance samples, recording titles, and selected ranges are excluded from Mobile Dev's Sentry telemetry. Results shared with your ADE follow the host's own handling; see [Privacy](/docs/privacy).
