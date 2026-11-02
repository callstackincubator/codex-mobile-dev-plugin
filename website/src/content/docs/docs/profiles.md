---
title: Profiles
description: Analyze local CPU and React profiles with TraceSift, explore measured findings, and send a selected investigation to your coding agent.
---

Use **TraceSift** in Mobile Dev to analyze a local CPU profile or a React DevTools profiling export. The results connect measured work to the app's features and give your agent context for an investigation.

## Requirements

Install and configure TraceSift locally. Mobile Dev finds it on `PATH` or through `TRACE_SIFT_COMMAND`. If setup is missing, follow the installation or `tracesift init` guidance returned by the tool.

This workflow analyzes an existing profile. Mobile Dev's [CPU, memory, and Display FPS recordings](/docs/performance) are a separate kind of measurement.

## Analyze a profile

1. Open **TraceSift** in the device panel and choose the local profile file, or give its path to your agent and ask it to analyze the profile.
2. Choose the app's source project folder in the panel so an investigation can identify the code the findings belong to.
3. Read the measured finding cards. CPU profiles produce task cards; React profiles produce React commit cards.

Each card shows how its measured task divides between the features it entered. Hover or open the bands for detail, and switch between the bar and treemap views where available.

## Explore a finding

Choose **Explore** to open the finding's call tree, flame graph, and timeline. You can also open the explorer in a browser or copy the card's investigation context.

Exploring the result does not itself ask the agent to edit your app. Choose **Investigate** on the finding you want to work on. Mobile Dev sends that finding and the selected project context into your active conversation, where you can discuss the measured path and the next change.

## Data and persistence

Profiles are sent to a TraceSift service on your own computer. Analysis references and the chosen source folder are saved locally under `~/.tracesift/integrations/mobile-dev` by default, or the corresponding `TRACE_SIFT_HOME` directory.

Profile contents and source paths can be sensitive. Review them before sharing investigation context with your host. Profile contents are excluded from Mobile Dev's Sentry telemetry; host and support sharing are separate. See [Privacy](/docs/privacy).
