---
title: Profiles
description: Record a React Native CPU profile or analyze an existing CPU or React profile with TraceSift, then investigate measured findings.
---

Use **TraceSift** in Mobile Dev to record a running React Native app or analyze a local CPU profile or React DevTools profiling export. The results connect measured work to the app's features and give your agent context for an investigation.

## Requirements

TraceSift profile analysis requires a macOS or Linux host. Install and configure TraceSift locally. Mobile Dev finds it on `PATH` or through `TRACE_SIFT_COMMAND`. If setup is missing, follow the installation or `tracesift init` guidance returned by the tool.

Recording a React Native app requires a reachable Hermes profiler. Debug builds use Metro's inspector, so Metro must be running; release and profiling builds use `@callstack/tracesift-profiler` without Metro. Close React Native DevTools before recording because Hermes allows one sampler at a time. Mobile Dev's [CPU, memory, and Display FPS recordings](/docs/performance) are a separate kind of measurement.

## Record a React Native profile

1. Open **TraceSift** in the device panel and choose **Record**. Select the React Native project, install the TraceSift profiler if prompted, and use **Run with TraceSift** to build and launch it on a connected device or booted simulator or emulator. If a compatible app is already running, you can select it directly.
2. Under **Select a running app**, refresh the list if needed, choose the app, and select **Start profile**. Exercise the interaction you want to measure.
3. Select **Stop and analyze**. TraceSift saves the Hermes CPU profile and opens its findings. On iOS, the profiling build generates source maps automatically; on Android, source maps require app configuration.

An agent can also record a reachable React Native app when this chat has a selected project directory. A profiling build can replace the installed app on the chosen device.

## Analyze a profile

1. Open **TraceSift** in the device panel, choose **Upload**, select the CPU or React profile type, and choose the local file. You can also give its path to your agent and ask it to analyze the profile.
2. Read the measured finding cards. CPU profiles produce task cards; React profiles produce React commit cards.

Each card shows how its measured task divides between the features it entered. Hover or open the bands for detail, and switch between the bar and treemap views where available.

## Explore a finding

Choose **Explore** to open the finding's call tree, flame graph, and timeline. You can also open the explorer in a browser or copy the card's investigation context.

Exploring the result does not itself ask the agent to edit your app. Choose **Investigate** on the finding you want to work on. Mobile Dev sends its measured context into your active conversation, where the agent can inspect the project selected in that chat and discuss the next change.

## Data and persistence

Profiles are sent to a TraceSift service on your own computer. Analysis references and any project folder chosen for a profiling build are saved locally under `~/.tracesift/integrations/mobile-dev` by default, or the corresponding `TRACE_SIFT_HOME` directory. Profiles recorded through Mobile Dev are saved separately under `~/Library/Application Support/mobile-dev/tracesift`. In **Upload**, choose **Recorded profiles** to analyze one again or use its delete button to remove that saved profile. Deleting it also removes its local project-name metadata.

Profile contents and source paths can be sensitive. Review them before sharing investigation context with your host. Profile contents are excluded from Mobile Dev's Sentry telemetry; host and support sharing are separate. See [Privacy](/docs/privacy).
