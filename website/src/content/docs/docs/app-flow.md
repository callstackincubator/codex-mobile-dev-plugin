---
title: App Flow
description: Map every screen and navigation edge in an Expo Router or React Navigation app, capture each screen, and record a path to the ones a walk cannot reach.
---

Open **App Flow** to build a visual map of your app's screens and the navigation between them. It reads the navigation out of your project's source, and can walk the app on an iOS simulator to photograph every screen it reaches.

App Flow works with Expo Router and React Navigation projects. Your project's own tools build and run the app.

## Choose a project

App Flow works on a project folder rather than on the selected device alone. Choose the React Native project folder in the panel, or ask your agent to open one:

> Map the screens in this project.

Each project keeps its own map, captures, and recorded paths. Switching projects switches the map.

## Build the map

Pick a capture mode in the toolbar:

| Mode | What it does |
| --- | --- |
| Structure only | Reads the navigation out of your source. It takes seconds and needs no device, but produces no screenshots. |
| Screen UI + Structure | Also walks the app on an iOS simulator and photographs every screen it reaches. Sign in first. |

In **Screen UI + Structure**, **Capture options** adds a **Capture UI states** switch that also opens each screen's sheets, modals, and dialogs during capture. The choice is remembered per project.

Choose **Start Building App Flow** to begin. The run is non-blocking: progress appears in the panel while you keep working, and a paused or inactivity-suspended run resumes when you start the same project again, keeping the screens it already completed.

## What the walk needs

The walk runs your project's `ios` script and then Metro. Without that script there is no walk, and Mobile Dev does not add one.

- An existing install is reused while the native sources are unchanged.
- Runtime navigation reads need a debug build; a release build has no DevTools hook.
- Deep links need a URL scheme the project's navigation prefixes include.

The walk stops and asks when it needs you, for example to complete sign-in in the simulator. Act on the device, then continue the run from the panel. Your agent cannot resolve these prompts for you.

## Reach a screen

App Flow tries in-app navigation, then a deep link, then a path you recorded. This deterministic pass uses no model.

Choose **Launch App** to start the app without walking it.

## Record a path by hand

For a screen the walk cannot reach, choose **Record path** on its node. Pick elements on the live wireframe of the device and the recorder stores each step. Elements with an id or an accessibility label replay reliably; a step matched on position only does not survive a layout change.

Stopping saves the path as a verified replay or as a command list. The app stays running, so you can record a path to the next screen straight away, or discard the recording. A saved path can later be replayed from the node, and every node also offers a replay through the running app's navigator that needs no recording.

## Explore with AI

**Explore with AI** lists the screens the deterministic pass could not reach. Preview a screen on the canvas to see where it sits, tick the ones worth a model walk, and start the continuation. It reuses the verified replays already recorded and explores only the screens you picked.

Only the screens you select are explored. The deterministic pass remains the default.

## Read the map

The **Flow graph** canvas shows screens as nodes and the navigation between them as edges. Switch to **UI states** to see each screen's sheets, modals, and dialogs as child nodes, derived from what the screen's own source proves it can open.

App Flow does not fire destructive handlers such as save, delete, submit, or sign out, and does not open states whose names look sensitive.

## Clear a map

**Clear app flow** deletes the map, its captures, and its recorded paths for the selected project. Deleted captures cannot be recovered through Mobile Dev.

## Saved data

Maps, screen captures, and recorded paths are stored as private files under `~/Library/Application Support/mobile-dev/app-flow`. They survive plugin restarts and are not automatically deleted.

Screenshots, screen captures, and recorded input are excluded from Mobile Dev's Sentry telemetry. Captures you send to chat follow the host's own handling; see [Privacy](/docs/privacy).
